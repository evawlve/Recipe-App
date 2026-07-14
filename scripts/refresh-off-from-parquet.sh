#!/usr/bin/env bash
#
# refresh-off-from-parquet.sh — quarterly full refresh of the OffFood table
# from Open Food Facts' Parquet export. Cron-installed on the Mini-PC.
#
# WHY THIS EXISTS: the weekly delta cron (ingest-off-delta.ts) consumes OFF's
# JSONL delta files, which inherit the JSONL export's missing-`nutriments` bug
# (~100-140K US products affected) and also can't represent deletions. This
# pipeline re-sources everything from the Parquet export (which doesn't have
# the hole), replacing the old multi-hour raw-JSONL re-ingest:
#
#   download Parquet (~7GB) -> off-parquet-to-jsonl.sh (slim ~330MB JSONL)
#   -> ingest-off.ts --fresh -> meilisearch-sync.ts
#
# See the mobile repo's sync-docs/handoff_food_data_quality_audit.md
# ("TRUE root cause" section) for the full investigation.
#
# Safe to run manually at any time:
#   ~/Recipe-App/scripts/refresh-off-from-parquet.sh

set -euo pipefail

REPO="${REPO:-$HOME/Recipe-App}"
WORKDIR="${WORKDIR:-$HOME/Downloads}"
PARQUET="$WORKDIR/off-food.parquet"
SLIM_JSONL="$WORKDIR/off-products-parquet.jsonl.gz"
PARQUET_URL='https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet?download=true'

export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"

cd "$REPO"
export DATABASE_URL="${DATABASE_URL:-$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')}"
export OFF_COUNTRIES="${OFF_COUNTRIES:-united-states,canada,united-kingdom,ireland,australia,new-zealand}"

echo "[$(date -Is)] Downloading Parquet export..."
curl -fsSL --retry 3 -o "$PARQUET.tmp" "$PARQUET_URL"
mv "$PARQUET.tmp" "$PARQUET"
echo "[$(date -Is)] Downloaded: $(du -h "$PARQUET" | cut -f1)"

echo "[$(date -Is)] Converting Parquet -> slim JSONL..."
"$REPO/scripts/off-parquet-to-jsonl.sh" "$PARQUET" "$SLIM_JSONL"

echo "[$(date -Is)] Running --fresh ingest..."
node_modules/.bin/ts-node --project tsconfig.scripts.json --transpile-only \
  scripts/ingest-off.ts "$SLIM_JSONL" --fresh

echo "[$(date -Is)] Re-syncing Meilisearch..."
node_modules/.bin/ts-node --project tsconfig.scripts.json --transpile-only \
  scripts/meilisearch-sync.ts

# The 7GB parquet is only needed transiently; the slim JSONL is kept as the
# record of what was ingested (and for cheap re-runs without a re-download).
rm -f "$PARQUET"

echo "[$(date -Is)] ✅ Refresh complete."
