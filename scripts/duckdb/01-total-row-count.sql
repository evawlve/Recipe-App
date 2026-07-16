-- Total row count in the current OFF Parquet export.
-- Run: duckdb < scripts/duckdb/01-total-row-count.sql
INSTALL httpfs;
LOAD httpfs;

SELECT count(*) AS total_rows
FROM read_parquet('https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet?download=true');
