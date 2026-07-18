#!/usr/bin/env python3
"""
Backfill / maintain semantic-search embeddings for OffFood on the Windows PC's GPU.

- Reads rows where embedding IS NULL, embeds "name — brand" with bge-small-en-v1.5
  on CUDA, writes vector(384) back to Postgres via a COPY-fed temp table.
- Keyset pagination on the `barcode` PK (OffFood's PK is barcode, not id).
- Idempotent: rerunning only touches still-NULL rows.

Modes:
  (default)     one-shot backfill of every NULL row, then exit 0.
  --listen      backfill once (reconcile), then LISTEN embed_pending and re-embed
                whenever the delta ingest notifies (via the off_food_embed_notify
                trigger). Auto-reconnects; also reconciles every ~300s as a safety
                net in case a notification is missed.

Typesense: in --listen mode (or with --typesense) each freshly embedded row is
also upserted as a full document (keyword fields + vector) into the off_foods
collection, so delta rows are searchable both by keyword and semantically without
a full resync. Postgres stays canonical.

Connection: --dsn, else $EMBED_DATABASE_URL, else $DATABASE_URL, else the Mini-PC default.
The bge model wants the query prefix ONLY at query time, never for stored documents.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request

MODEL_NAME = "BAAI/bge-small-en-v1.5"
DIM = 384
DEFAULT_DSN = "postgresql://postgres:yoursecurepassword@192.168.1.21:5432/mealspire"
DEFAULT_TS_URL = "http://192.168.1.21:8108"
DEFAULT_TS_KEY = "xyzapikey"
TS_COLLECTION = "off_foods"
NOTIFY_CHANNEL = "embed_pending"
SAFETY_RECONCILE_SECS = 300

_ws = re.compile(r"\s+")


def doc_text(name, brand):
    """Document text for embedding: 'name — brand', lowercased, whitespace-collapsed."""
    base = name if not brand else f"{name} — {brand}"
    return _ws.sub(" ", (base or "").strip().lower())


def vec_literal(row):
    """pgvector text format, e.g. '[0.12,-0.03,...]'."""
    return "[" + ",".join(f"{x:.6f}" for x in row) + "]"


def get_dsn(cli_dsn):
    return cli_dsn or os.environ.get("EMBED_DATABASE_URL") or os.environ.get("DATABASE_URL") or DEFAULT_DSN


class Typesense:
    """Minimal Typesense upsert client (stdlib only)."""

    def __init__(self, url, key):
        self.url = url.rstrip("/")
        self.key = key

    def upsert(self, docs):
        body = "\n".join(json.dumps(d) for d in docs).encode()
        req = urllib.request.Request(
            f"{self.url}/collections/{TS_COLLECTION}/documents/import?action=upsert",
            data=body,
            headers={"X-TYPESENSE-API-KEY": self.key, "Content-Type": "text/plain"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=120).read().decode()
        fails = [ln for ln in resp.splitlines() if '"success":true' not in ln]
        return len(docs) - len(fails), fails


def ts_doc(bc, name, brand, nutrients, serving_grams, serving_size, categories, emb_list):
    nut = nutrients if isinstance(nutrients, str) else json.dumps(nutrients or {})
    return {
        "id": str(bc),  # key TS doc by barcode so upserts are idempotent (no duplicates)
        "barcode": str(bc),
        "name": name,
        "brandName": brand or "",
        "nutrientsPer100g": nut,
        "servingGrams": float(serving_grams) if serving_grams is not None else None,
        "servingSize": serving_size or "",
        "categories": categories or "",
        "embedding": emb_list,
    }


def backfill(conn, model, batch, limit, encode_bs, ts=None, quiet_when_empty=False):
    """Embed all NULL rows via keyset pagination. Optionally push to Typesense. Returns count."""
    total_null = conn.execute('SELECT count(*) FROM "OffFood" WHERE embedding IS NULL').fetchone()[0]
    target = total_null if limit is None else min(limit, total_null)
    if target == 0:
        if not quiet_when_empty:
            print("[backfill] nothing to embed (0 NULL rows).")
        return 0
    print(f"[backfill] {total_null:,} NULL rows; embedding {target:,} (batch={batch}, encode_bs={encode_bs})")

    conn.execute("CREATE TEMP TABLE IF NOT EXISTS _emb (barcode text PRIMARY KEY, embedding vector(%s))" % DIM)
    conn.execute("TRUNCATE _emb")

    done = 0
    ts_ok = 0
    last = ""
    t0 = time.time()
    with conn.cursor() as read_cur:
        while done < target:
            take = min(batch, target - done)
            read_cur.execute(
                'SELECT barcode, name, "brandName", "nutrientsPer100g", "servingGrams", '
                '"servingSize", categories FROM "OffFood" '
                "WHERE embedding IS NULL AND barcode > %s ORDER BY barcode LIMIT %s",
                (last, take),
            )
            rows = read_cur.fetchall()
            if not rows:
                break
            last = rows[-1][0]
            texts = [doc_text(r[1], r[2]) for r in rows]
            embs = model.encode(texts, batch_size=encode_bs, normalize_embeddings=True, show_progress_bar=False)

            # write vectors to Postgres (canonical)
            with conn.cursor().copy("COPY _emb (barcode, embedding) FROM STDIN") as cp:
                for r, e in zip(rows, embs):
                    cp.write_row((r[0], vec_literal(e)))
            conn.execute('UPDATE "OffFood" o SET embedding = t.embedding FROM _emb t WHERE o.barcode = t.barcode')
            conn.execute("TRUNCATE _emb")
            conn.commit()

            # push full docs (keyword + vector) to Typesense serving copy
            if ts is not None:
                docs = [ts_doc(r[0], r[1], r[2], r[3], r[4], r[5], r[6], e.tolist()) for r, e in zip(rows, embs)]
                try:
                    ok, fails = ts.upsert(docs)
                    ts_ok += ok
                    if fails:
                        print(f"[backfill] typesense: {len(fails)} doc(s) failed, e.g. {fails[0][:160]}", file=sys.stderr)
                except Exception as e:  # noqa: BLE001 - don't let TS errors abort the PG backfill
                    print(f"[backfill] typesense upsert error: {e}", file=sys.stderr)

            done += len(rows)
            rate = done / max(time.time() - t0, 1e-6)
            eta = (target - done) / max(rate, 1e-6)
            print(f"[backfill] {done:,}/{target:,}  {rate:,.0f} rows/s  ETA {eta:,.0f}s", flush=True)

    extra = f", typesense upserted {ts_ok:,}" if ts is not None else ""
    print(f"[backfill] done: {done:,} rows in {time.time() - t0:,.1f}s{extra}")
    return done


def listen(dsn, model, batch, encode_bs, ts):
    """Reconcile on connect, then block on NOTIFY; reconnect on error, periodic safety reconcile."""
    import psycopg

    print(f"[listen] starting — LISTEN {NOTIFY_CHANNEL}, safety reconcile every {SAFETY_RECONCILE_SECS}s")
    while True:
        try:
            with psycopg.connect(dsn, autocommit=True) as lc:
                lc.execute(f"LISTEN {NOTIFY_CHANNEL}")
                # reconcile anything that arrived while we were down / not listening
                with psycopg.connect(dsn) as work:
                    backfill(work, model, batch, None, encode_bs, ts, quiet_when_empty=True)
                print("[listen] connected; waiting for notifications", flush=True)
                while True:
                    got = False
                    for _n in lc.notifies(timeout=SAFETY_RECONCILE_SECS, stop_after=1):
                        got = True
                    if got:
                        print("[listen] notified — embedding new rows", flush=True)
                    with psycopg.connect(dsn) as work:
                        backfill(work, model, batch, None, encode_bs, ts, quiet_when_empty=not got)
        except KeyboardInterrupt:
            print("[listen] stopped.")
            return
        except Exception as e:  # noqa: BLE001
            print(f"[listen] connection error: {e}; reconnecting in 10s", file=sys.stderr, flush=True)
            time.sleep(10)


def main():
    ap = argparse.ArgumentParser(description="Embed OffFood rows for semantic search.")
    ap.add_argument("--dsn", default=None, help="Postgres DSN (default: env or Mini-PC)")
    ap.add_argument("--batch", type=int, default=2000, help="rows fetched+written per DB round trip")
    ap.add_argument("--encode-bs", type=int, default=512, help="GPU encode batch size")
    ap.add_argument("--limit", type=int, default=None, help="embed at most N rows (testing)")
    ap.add_argument("--listen", action="store_true", help="after backfill, LISTEN and re-embed on notify")
    ap.add_argument("--typesense", action="store_true", help="also upsert vectors to Typesense (implied by --listen)")
    ap.add_argument("--no-typesense", action="store_true", help="disable Typesense upsert even in --listen")
    ap.add_argument("--ts-url", default=os.environ.get("TYPESENSE_HOST", DEFAULT_TS_URL))
    ap.add_argument("--ts-key", default=os.environ.get("TYPESENSE_API_KEY", DEFAULT_TS_KEY))
    ap.add_argument("--dry-run", action="store_true", help="load model + connect, embed nothing")
    ap.add_argument("--log-file", default=None, help="append stdout/stderr here (for windowless service runs)")
    args = ap.parse_args()

    if args.log_file:
        _f = open(args.log_file, "a", buffering=1, encoding="utf-8")
        sys.stdout = _f
        sys.stderr = _f
        print(f"\n===== embed_foods listener starting ({time.strftime('%Y-%m-%d %H:%M:%S')}) =====")

    import psycopg
    import torch
    from sentence_transformers import SentenceTransformer

    dsn = get_dsn(args.dsn)
    print(f"[init] dsn={re.sub(r'//[^@]+@', '//***@', dsn)}")

    ts = None
    if (args.listen or args.typesense) and not args.no_typesense:
        ts = Typesense(args.ts_url, args.ts_key)
        print(f"[init] typesense upsert -> {args.ts_url}/{TS_COLLECTION}")

    if not torch.cuda.is_available():
        print("[init] WARNING: CUDA not available — this will be slow on CPU.", file=sys.stderr)
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[init] loading {MODEL_NAME} on {dev} ...")
    model = SentenceTransformer(MODEL_NAME, device=dev)
    print(f"[init] model ready (dim={model.get_sentence_embedding_dimension()})")

    if args.dry_run:
        with psycopg.connect(dsn) as conn:
            n = conn.execute('SELECT count(*) FROM "OffFood" WHERE embedding IS NULL').fetchone()[0]
        print(f"[dry-run] {n:,} rows would be embedded. Exiting.")
        return 0

    with psycopg.connect(dsn) as conn:
        backfill(conn, model, args.batch, args.limit, args.encode_bs, ts)

    if args.listen:
        listen(dsn, model, args.batch, args.encode_bs, ts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
