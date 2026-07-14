-- Mirrors scripts/ingest-off.ts's REQUIRE_MACROS gate: keep a row only if
-- all four core per-100g macros are present (kcal, protein, carbs, fat).
-- A real 0 counts as present -- we check IS NOT NULL, not truthiness.
--
-- Schema note: `nutriments` in the Parquet export is a
-- LIST(STRUCT(name, value, "100g", serving, unit)) -- i.e. one struct per
-- named nutrient, not flat columns like `proteins_100g`. We pull the
-- "100g" field out of the struct whose name matches, via list_filter.
--
-- ingest-off.ts also falls back to nutriments['energy_100g'] when
-- 'energy-kcal_100g' is absent; the Parquet export only ever has an
-- 'energy-kcal' entry for kcal (a separate 'energy' entry is in kJ), so we
-- match ingest-off.ts's primary field only.
--
-- Run: duckdb < scripts/duckdb/02-macros-filter.sql
INSTALL httpfs;
LOAD httpfs;

WITH off_food AS (
  SELECT
    code,
    list_filter(nutriments, x -> x.name = 'energy-kcal')[1]."100g" AS kcal,
    list_filter(nutriments, x -> x.name = 'proteins')[1]."100g" AS protein,
    list_filter(nutriments, x -> x.name = 'carbohydrates')[1]."100g" AS carbs,
    list_filter(nutriments, x -> x.name = 'fat')[1]."100g" AS fat
  FROM read_parquet('https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet?download=true')
)
SELECT
  count(*) AS total_rows,
  count(*) FILTER (
    WHERE kcal IS NOT NULL
      AND protein IS NOT NULL
      AND carbs IS NOT NULL
      AND fat IS NOT NULL
  ) AS rows_with_all_macros
FROM off_food;
