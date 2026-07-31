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
#   -> ingest-off.ts --fresh -> sync-typesense.ts
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
if [ "$PREFLIGHT_ONLY" -eq 1 ]; then
  echo "[$(date -Is)] --preflight-only: all guards pass. Nothing downloaded, nothing written."
  exit 0
fi

echo "[$(date -Is)] Downloading Parquet export..."
curl -fsSL --retry 3 -o "$PARQUET.tmp" "$PARQUET_URL"
mv "$PARQUET.tmp" "$PARQUET"
echo "[$(date -Is)] Downloaded: $(du -h "$PARQUET" | cut -f1)"

echo "[$(date -Is)] Converting Parquet -> slim JSONL..."
"$REPO/scripts/off-parquet-to-jsonl.sh" "$PARQUET" "$SLIM_JSONL"

echo "[$(date -Is)] Running --fresh ingest..."
node_modules/.bin/ts-node --project tsconfig.scripts.json --transpile-only \
  scripts/ingest-off.ts "$SLIM_JSONL" --fresh

echo "[$(date -Is)] Re-syncing Typesense..."
node_modules/.bin/ts-node --project tsconfig.scripts.json --transpile-only \
  scripts/sync-typesense.ts

# The 7GB parquet is only needed transiently; the slim JSONL is kept as the
# record of what was ingested (and for cheap re-runs without a re-download).
rm -f "$PARQUET"

echo "[$(date -Is)] ✅ Refresh complete."
