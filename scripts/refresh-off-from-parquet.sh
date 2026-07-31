#!/usr/bin/env bash
#
# refresh-off-from-parquet.sh — quarterly full refresh of the OffFood table
# from Open Food Facts' Parquet export.
#
# WHY THIS EXISTS: the weekly delta cron (ingest-off-delta.ts) consumes OFF's
# JSONL delta files, which inherit the JSONL export's missing-`nutriments` bug
# and also can't represent deletions. Measured 2026-07-30 on a real delta file:
# 2,937 of 2,939 US/EN products (99.9%) carry NO `nutriments` object at all, and
# a 12-day catch-up run scanned 61,796 lines and would have upserted 0. So the
# delta lane is a near-no-op for nutrition and THIS script is the only thing
# that actually refreshes the corpus. Do not read a green weekly delta run as
# "the corpus is fresh".
#
#   download Parquet (~7GB) -> off-parquet-to-jsonl.sh (slim ~330MB JSONL)
#   -> snapshot FoodMapping -> ingest-off.ts --fresh -> restore-off-pointers.ts
#   -> sync-typesense.ts
#
# The snapshot/restore pair either side of the ingest is not optional bookkeeping:
# `--fresh` NULLs FoodMapping.offBarcode on ~81% of the cache to satisfy the FK
# before deleting OffFood. Barcodes are OFF's stable primary key, so those
# pointers are recoverable — but only from a snapshot taken BEFORE the truncate.
# Embeddings are the other loss and are NOT restored here: re-run embed_foods.py
# afterwards (measured 2026-07-30: ~327 rows/sec on the box's CPU, so ~55min for
# the full corpus — a GPU is not required).
#
# See the mobile repo's sync-docs/archive/handoff_food_data_quality_audit.md
# ("TRUE root cause" section) for the full investigation.
#
# Safe to run manually at any time, ON THE BOX:
#   ~/Recipe-App/scripts/refresh-off-from-parquet.sh
#
# --preflight-only runs every safety check and exits without downloading or
# writing anything. The destructive path takes ~hours and cannot be rehearsed,
# so this is the only way to know the guards work before the quarterly timer
# fires; the timer's first real run is still a human decision.

set -euo pipefail

PREFLIGHT_ONLY=0
for a in "$@"; do
  case "$a" in
    --preflight-only) PREFLIGHT_ONLY=1 ;;
    *) echo "unknown argument: $a" >&2; exit 64 ;;
  esac
done

REPO="${REPO:-$HOME/Recipe-App}"
WORKDIR="${WORKDIR:-$HOME/Downloads}"
PARQUET="$WORKDIR/off-food.parquet"
SLIM_JSONL="$WORKDIR/off-products-parquet.jsonl.gz"
PARQUET_URL='https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet?download=true'

export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"

cd "$REPO"
export DATABASE_URL="${DATABASE_URL:-$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')}"
export OFF_COUNTRIES="${OFF_COUNTRIES:-united-states,canada,united-kingdom,ireland,australia,new-zealand}"

# PREFLIGHT — every one of these must hold BEFORE the destructive `--fresh`
# ingest truncates OffFood. This block exists because the script previously
# ended in `meilisearch-sync.ts`, a file deleted when the provider became
# Typesense: under `set -e` that aborted AFTER the truncate-and-reingest, so a
# quarterly run would have left the corpus rebuilt and the search index stale,
# and reported failure only in a log nobody reads. Fail before touching data.
echo "[$(date -Is)] Preflight..."
PREFLIGHT_FAIL=0
# HOST GUARD — this must run ON the box. Every dev machine's .env points
# DATABASE_URL at the box's Postgres (192.168.1.133:5432), so running this from
# a laptop truncates the LIVE OffFood table. That is not hypothetical: on
# 2026-07-30 a run started from the Mac got as far as the finished slim JSONL,
# two steps from the truncate, before a timeout ended it. Override only if you
# have read this and mean it: OFF_REFRESH_ALLOW_REMOTE=1.
if [ "$(hostname)" != "DHL32-Opt-5060" ] && [ "${OFF_REFRESH_ALLOW_REMOTE:-0}" != "1" ]; then
  echo "  ❌ not running on the box (hostname=$(hostname)) — this truncates the LIVE OffFood table."
  echo "     Run it on the box:  ssh owner@192.168.1.133 '~/Recipe-App/scripts/refresh-off-from-parquet.sh'"
  PREFLIGHT_FAIL=1
fi
command -v duckdb >/dev/null 2>&1 || { echo "  ❌ duckdb CLI not on PATH (needed by off-parquet-to-jsonl.sh)"; PREFLIGHT_FAIL=1; }
[ -x "$REPO/scripts/off-parquet-to-jsonl.sh" ] || { echo "  ❌ scripts/off-parquet-to-jsonl.sh missing or not executable"; PREFLIGHT_FAIL=1; }
[ -f "$REPO/scripts/ingest-off.ts" ]           || { echo "  ❌ scripts/ingest-off.ts missing"; PREFLIGHT_FAIL=1; }
[ -f "$REPO/scripts/sync-typesense.ts" ]       || { echo "  ❌ scripts/sync-typesense.ts missing"; PREFLIGHT_FAIL=1; }
# The snapshot/restore pair is checked HERE because a missing restore path
# discovered after the truncate is a missing restore path, not an error message.
[ -f "$REPO/scripts/eval/_snap_foodmapping.ts" ]     || { echo "  ❌ scripts/eval/_snap_foodmapping.ts missing — no pre-truncate snapshot is possible"; PREFLIGHT_FAIL=1; }
[ -f "$REPO/scripts/eval/restore-off-pointers.ts" ]  || { echo "  ❌ scripts/eval/restore-off-pointers.ts missing — the cache pointers would be unrecoverable"; PREFLIGHT_FAIL=1; }
[ -x "$REPO/node_modules/.bin/ts-node" ]       || { echo "  ❌ node_modules/.bin/ts-node missing — run npm ci"; PREFLIGHT_FAIL=1; }
[ -n "${DATABASE_URL:-}" ]                     || { echo "  ❌ DATABASE_URL empty"; PREFLIGHT_FAIL=1; }
# ~7GB parquet + ~330MB slim JSONL + headroom.
AVAIL_KB=$(df -Pk "$WORKDIR" 2>/dev/null | awk 'NR==2{print $4}')
[ "${AVAIL_KB:-0}" -ge 15000000 ] || { echo "  ❌ <15GB free on $WORKDIR (have ${AVAIL_KB:-0}KB)"; PREFLIGHT_FAIL=1; }
if [ "$PREFLIGHT_FAIL" -ne 0 ]; then
  echo "[$(date -Is)] ❌ Preflight failed — refusing to run. NOTHING was changed."
  exit 2
fi
echo "[$(date -Is)] Preflight OK."

# BLAST RADIUS — print what `ingest-off.ts --fresh` will destroy, from the live
# DB, every time. Measured 2026-07-30 the first time anyone looked: this is not
# "refresh the corpus", it is a rebuild that also drops ~1.07M pgvector
# embeddings and NULLs the offBarcode on ~81% of the FoodMapping cache.
echo "[$(date -Is)] Blast radius (live):"
node_modules/.bin/ts-node --project tsconfig.scripts.json --transpile-only -e '
const { PrismaClient } = require("@prisma/client");
(async () => {
  const p = new PrismaClient();
  const [r] = await p.$queryRawUnsafe(`SELECT
    (SELECT count(*) FROM "OffFood")                                     AS offfood,
    (SELECT count(*) FROM "OffFood" WHERE embedding IS NOT NULL)         AS embedded,
    (SELECT count(*) FROM "OffServing")                                  AS servings,
    (SELECT count(*) FROM "FoodMapping" WHERE "offBarcode" IS NOT NULL)  AS mapped`);
  console.log(`  OffFood rows deleted        : ${r.offfood}`);
  console.log(`  ...pgvector embeddings lost : ${r.embedded}  (NOT restored here — re-run scripts/embed_foods.py; ~55min on this box CPU, measured 2026-07-30)`);
  console.log(`  OffServing rows deleted     : ${r.servings}`);
  console.log(`  FoodMapping.offBarcode NULLed: ${r.mapped}  (RESTORED automatically after the ingest, minus products OFF delisted)`);
  await p.$disconnect();
})();' || { echo "  ❌ could not read the blast radius — refusing to guess"; exit 2; }

if [ "$PREFLIGHT_ONLY" -eq 1 ]; then
  echo "[$(date -Is)] --preflight-only: all guards pass. Nothing downloaded, nothing written."
  exit 0
fi

# ACKNOWLEDGEMENT GATE — the numbers above are why this cannot be an unattended
# job. A timer fires with a bare environment, so a scheduled run lands here and
# stops; a human who has read the blast radius and has a re-embedding plan sets
# the variable. This is deliberate: losing 1M embeddings quietly at 02:00 on a
# Tuesday is exactly the kind of failure this codebase keeps writing gates for.
if [ "${OFF_REFRESH_I_ACCEPT_DATA_LOSS:-0}" != "1" ]; then
  echo "[$(date -Is)] ⛔ Refusing: this rebuilds the corpus and drops the embeddings above."
  echo "     Nothing was downloaded or written."
  echo "     Recoverable automatically by this script:"
  echo "       - FoodMapping.offBarcode — snapshotted before the truncate and restored after."
  echo "     NOT recovered here, plan for it first:"
  echo "       - the pgvector embeddings. Re-run scripts/embed_foods.py afterwards"
  echo "         (~327 rows/sec on this box's CPU, measured 2026-07-30 — no GPU needed)."
  echo "         Until it finishes, keyword search is unaffected but semantic recall is degraded."
  echo "       - cache rows whose product OFF has delisted; the restore prints them as a worklist."
  echo "     Then re-run with OFF_REFRESH_I_ACCEPT_DATA_LOSS=1."
  exit 3
fi
echo "[$(date -Is)] OFF_REFRESH_I_ACCEPT_DATA_LOSS=1 — proceeding with the destructive refresh."

echo "[$(date -Is)] Downloading Parquet export..."
curl -fsSL --retry 3 -o "$PARQUET.tmp" "$PARQUET_URL"
mv "$PARQUET.tmp" "$PARQUET"
echo "[$(date -Is)] Downloaded: $(du -h "$PARQUET" | cut -f1)"

echo "[$(date -Is)] Converting Parquet -> slim JSONL..."
"$REPO/scripts/off-parquet-to-jsonl.sh" "$PARQUET" "$SLIM_JSONL"

# SNAPSHOT — Role B (restore anchor): taken as late as possible, immediately
# before the truncate, so live traffic between here and the ingest is minimal.
# Deliberately AFTER the slow download/convert, which can take hours.
SNAP="$WORKDIR/FoodMapping-pre-refresh-$(date -u +%Y-%m-%dT%H-%M-%SZ).json"
echo "[$(date -Is)] Snapshotting FoodMapping -> $SNAP"
node_modules/.bin/ts-node --project tsconfig.scripts.json --transpile-only \
  -r tsconfig-paths/register scripts/eval/_snap_foodmapping.ts "$SNAP"

echo "[$(date -Is)] Running --fresh ingest..."
node_modules/.bin/ts-node --project tsconfig.scripts.json --transpile-only \
  scripts/ingest-off.ts "$SLIM_JSONL" --fresh

# RESTORE — exit 3 means "completed, with residue an operator must reconcile"
# (products OFF delisted). That is an expected outcome of a real refresh, not a
# failure, so it must not abort the run under `set -e`; exit 2 is a refusal and
# MUST stop everything. Anything else is unknown and also stops.
echo "[$(date -Is)] Restoring FoodMapping.offBarcode pointers..."
set +e
node_modules/.bin/ts-node --project tsconfig.scripts.json --transpile-only \
  -r tsconfig-paths/register scripts/eval/restore-off-pointers.ts "$SNAP" --execute
RESTORE_RC=$?
set -e
case "$RESTORE_RC" in
  0) echo "[$(date -Is)] Pointers fully restored." ;;
  3) echo "[$(date -Is)] ⚠️  Pointers restored with residue (see the worklist above). Snapshot kept: $SNAP" ;;
  *) echo "[$(date -Is)] ❌ Pointer restore FAILED (rc=$RESTORE_RC). The cache is missing its OFF pointers."
     echo "     The snapshot is intact — replay by hand:"
     echo "     scripts/eval/restore-off-pointers.ts $SNAP --execute"
     exit "$RESTORE_RC" ;;
esac

echo "[$(date -Is)] Re-syncing Typesense..."
node_modules/.bin/ts-node --project tsconfig.scripts.json --transpile-only \
  scripts/sync-typesense.ts

# The 7GB parquet is only needed transiently; the slim JSONL is kept as the
# record of what was ingested (and for cheap re-runs without a re-download).
rm -f "$PARQUET"

# The snapshot is deliberately NOT deleted: it is the only record of what the
# pointers were, and the restore's residue worklist is only actionable against it.
echo "[$(date -Is)] ✅ Refresh complete."
echo "[$(date -Is)] NEXT: every OffFood row now has a NULL embedding — semantic recall is"
echo "     degraded until you run scripts/embed_foods.py (keyword search is unaffected;"
echo "     the Typesense vector field is optional). Snapshot retained at: $SNAP"
