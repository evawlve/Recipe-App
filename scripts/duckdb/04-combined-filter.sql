-- Combined estimate: rows surviving BOTH the macros gate (02) AND the US
-- country gate (03) -- our best real-world estimate of how many rows a
-- fresh `npx ts-node scripts/ingest-off.ts --fresh` re-ingest would
-- actually produce, before the additional category/name/Atwater-sanity
-- filters in ingest-off.ts (those need row-level text matching that's not
-- worth replicating here for a quick sanity check).
--
-- Run: duckdb < scripts/duckdb/04-combined-filter.sql
INSTALL httpfs;
LOAD httpfs;

WITH off_food AS (
  SELECT
    code,
    countries_tags,
    list_filter(nutriments, x -> x.name = 'energy-kcal')[1]."100g" AS kcal,
    list_filter(nutriments, x -> x.name = 'proteins')[1]."100g" AS protein,
    list_filter(nutriments, x -> x.name = 'carbohydrates')[1]."100g" AS carbs,
    list_filter(nutriments, x -> x.name = 'fat')[1]."100g" AS fat
  FROM read_parquet('https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet?download=true')
),
flagged AS (
  SELECT
    *,
    (kcal IS NOT NULL AND protein IS NOT NULL AND carbs IS NOT NULL AND fat IS NOT NULL) AS has_macros,
    (
      list_contains(countries_tags, 'en:united-states')
      OR len(list_filter(countries_tags, t -> t LIKE '%:united-states')) > 0
    ) AS is_us
  FROM off_food
)
SELECT
  count(*) AS total_rows,
  count(*) FILTER (WHERE has_macros) AS rows_with_macros,
  count(*) FILTER (WHERE is_us) AS rows_us,
  count(*) FILTER (WHERE has_macros AND is_us) AS rows_macros_and_us
FROM flagged;
