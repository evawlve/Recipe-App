-- Mirrors scripts/ingest-off.ts's KEEP_COUNTRIES gate (default:
-- OFF_COUNTRIES=united-states): keep a row if `countries_tags` contains a
-- tag matching `en:united-states` or ending in `:united-states`.
--
-- NOT modeled here: ingest-off.ts also keeps a row when countries_tags is
-- EMPTY and the barcode starts with '0' (a GTIN-prefix heuristic for
-- "probably US, just untagged"). That's a barcode-prefix table lookup, not
-- something meaningfully expressible as a single count here -- see the
-- commented-out variant at the bottom of this file if you want to include
-- it (it will inflate the count vs. a strict tag-only match).
--
-- Run: duckdb < scripts/duckdb/03-us-country-filter.sql
INSTALL httpfs;
LOAD httpfs;

WITH off_food AS (
  SELECT code, countries_tags
  FROM read_parquet('https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet?download=true')
)
SELECT
  count(*) AS total_rows,
  count(*) FILTER (
    WHERE list_contains(countries_tags, 'en:united-states')
       OR len(list_filter(countries_tags, t -> t LIKE '%:united-states')) > 0
  ) AS rows_tagged_us
FROM off_food;

-- Looser variant matching ingest-off.ts's full logic (tag match OR
-- untagged-but-barcode-starts-with-0). Uncomment to run:
--
-- WITH off_food AS (
--   SELECT code, countries_tags
--   FROM read_parquet('https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet?download=true')
-- )
-- SELECT
--   count(*) AS total_rows,
--   count(*) FILTER (
--     WHERE list_contains(countries_tags, 'en:united-states')
--        OR len(list_filter(countries_tags, t -> t LIKE '%:united-states')) > 0
--        OR (len(countries_tags) = 0 AND code LIKE '0%')
--   ) AS rows_tagged_us_or_fallback
-- FROM off_food;
