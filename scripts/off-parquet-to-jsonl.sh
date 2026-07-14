#!/usr/bin/env bash
#
# off-parquet-to-jsonl.sh — convert Open Food Facts' Parquet export into
# OFF-dump-shaped JSONL(.gz) that scripts/ingest-off.ts consumes unchanged.
#
# WHY: OFF's official JSONL dump (openfoodfacts-products.jsonl.gz) omits the
# entire `nutriments` object for a large slice of products (~100-140K US rows,
# incl. the Mission Carb Balance line) that the Parquet export has. See
# sync-docs/handoff_food_data_quality_audit.md ("TRUE root cause") in the
# mobile repo. So the bulk ingest now sources from Parquet:
#
#   1. Download the Parquet (~7.1GB):
#      curl -L -o food.parquet 'https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet?download=true'
#   2. ./scripts/off-parquet-to-jsonl.sh food.parquet off-products.jsonl.gz
#   3. ts-node scripts/ingest-off.ts off-products.jsonl.gz --fresh
#
# Only the fields parseOffProduct() (scripts/lib/off-parse.ts) reads are
# emitted, so the output is far smaller than the raw dump. The delta ingest
# (ingest-off-delta.ts) still consumes OFF's JSONL delta files directly — those
# inherit the JSONL nutriments hole, which a periodic re-run of this full
# Parquet pipeline papers over.
#
# Requires the duckdb CLI (https://duckdb.org/docs/installation). Memory-capped
# at 2GB so it can run on the RAM-starved Mini-PC.

set -euo pipefail

INPUT="${1:?usage: off-parquet-to-jsonl.sh <food.parquet> <out.jsonl.gz>}"
OUTPUT="${2:?usage: off-parquet-to-jsonl.sh <food.parquet> <out.jsonl.gz>}"

duckdb <<SQL
PRAGMA memory_limit='2GB';
PRAGMA threads=2;

COPY (
  SELECT
    code,
    coalesce(
      list_transform(list_filter(product_name, lambda x: x.lang = 'main'), lambda x: x.text)[1],
      list_transform(list_filter(product_name, lambda x: x.lang = 'en'), lambda x: x.text)[1],
      product_name[1].text
    ) AS product_name,
    brands,
    categories,
    serving_size,
    serving_quantity,
    countries_tags,
    {
      'energy-kcal_100g':     list_filter(nutriments, lambda n: n.name = 'energy-kcal')[1]."100g",
      'energy_100g':          list_filter(nutriments, lambda n: n.name = 'energy')[1]."100g",
      'fat_100g':             list_filter(nutriments, lambda n: n.name = 'fat')[1]."100g",
      'carbohydrates_100g':   list_filter(nutriments, lambda n: n.name = 'carbohydrates')[1]."100g",
      'proteins_100g':        list_filter(nutriments, lambda n: n.name = 'proteins')[1]."100g",
      'fiber_100g':           list_filter(nutriments, lambda n: n.name = 'fiber')[1]."100g",
      'sugars_100g':          list_filter(nutriments, lambda n: n.name = 'sugars')[1]."100g",
      'sodium_100g':          list_filter(nutriments, lambda n: n.name = 'sodium')[1]."100g",
      'energy-kcal_serving':  list_filter(nutriments, lambda n: n.name = 'energy-kcal')[1].serving,
      'energy_serving':       list_filter(nutriments, lambda n: n.name = 'energy')[1].serving,
      'fat_serving':          list_filter(nutriments, lambda n: n.name = 'fat')[1].serving,
      'carbohydrates_serving':list_filter(nutriments, lambda n: n.name = 'carbohydrates')[1].serving,
      'proteins_serving':     list_filter(nutriments, lambda n: n.name = 'proteins')[1].serving,
      'fiber_serving':        list_filter(nutriments, lambda n: n.name = 'fiber')[1].serving,
      'sugars_serving':       list_filter(nutriments, lambda n: n.name = 'sugars')[1].serving,
      'sodium_serving':       list_filter(nutriments, lambda n: n.name = 'sodium')[1].serving
    } AS nutriments
  FROM read_parquet('${INPUT}')
) TO '${OUTPUT}' (FORMAT JSON, COMPRESSION gzip);
SQL

echo "✅ Wrote ${OUTPUT}"
