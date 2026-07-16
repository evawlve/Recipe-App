# DuckDB exploration toolkit (read-only, no local ingest)

## Why this exists

Our local ingest (`scripts/ingest-off.ts`) streams a 9GB+ JSONL dump of Open
Food Facts (OFF) data line-by-line -- a multi-hour job. We discovered our
currently-ingested Postgres data is stale (77% of ~4.2M rows are missing
per-100g macros, and spot-checks show a meaningful chunk of "empty" barcodes
now have full nutrition data OFF-side that our old dump predates).

Before committing to another multi-hour re-ingest, we want a fast way to ask
"how many rows would survive filter X against OFF's *current* data" --
without touching our database or running the ingest script. OFF publishes a
Parquet export of the full dump (trimmed/deduplicated schema vs. the raw
JSONL) that DuckDB can query directly over HTTP via the `httpfs` extension --
no local download or import needed.

## Requirements

- **DuckDB CLI**. Check with `which duckdb`. If missing: `brew install duckdb`
  (macOS). *(On this run, DuckDB was not preinstalled; it was installed via
  `brew install duckdb` with permission -- version 1.5.4.)*
- Network access to `huggingface.co` (the Parquet file is hosted there).
- Nothing else -- these are read-only queries against OFF's own public data.
  They never touch our Postgres database or `.env`.

## How to run

Each `.sql` file is self-contained (installs/loads `httpfs` itself), so run
any of them directly:

```sh
duckdb < scripts/duckdb/01-total-row-count.sql
duckdb < scripts/duckdb/02-macros-filter.sql
duckdb < scripts/duckdb/03-us-country-filter.sql
duckdb < scripts/duckdb/04-combined-filter.sql
```

or open an interactive session and `.read` them:

```sh
duckdb
D .read scripts/duckdb/04-combined-filter.sql
```

The full-table queries (02/03/04) scan the entire remote Parquet file (no
`LIMIT`), so expect them to take a while and to transfer a non-trivial amount
of data each run -- see the rate-limiting note below.

## Parquet export URL

```
https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet?download=true
```

Confirmed live and queryable via `duckdb`'s `read_parquet()` + `httpfs` as of
**2026-07-12**. If it 404s later, check
https://huggingface.co/datasets/openfoodfacts/product-database for the
current filename. (The commonly-cited fallback
`https://static.openfoodfacts.org/data/food.parquet` returned a 404 when
tried on this date -- don't assume it still works.)

## Schema notes (found by running `DESCRIBE SELECT * FROM read_parquet(...)`)

This cost some trial and error, so it's worth writing down:

- `nutriments` is **not** a set of flat columns like `proteins_100g`. It's
  `LIST(STRUCT(name VARCHAR, value FLOAT, "100g" FLOAT, serving FLOAT, unit
  VARCHAR))` -- one struct entry per named nutrient (`energy-kcal`,
  `proteins`, `carbohydrates`, `fat`, `sugars`, ... 70+ names observed in a
  5,000-row sample). To get a specific per-100g value:
  ```sql
  list_filter(nutriments, x -> x.name = 'proteins')[1]."100g"
  ```
- `countries_tags` is `VARCHAR[]`, matching `ingest-off.ts`'s expectation
  (values like `en:united-states`).
- Row count of the full export: **4,602,202** (see "Actual results" below).

## Filters mirrored (matching `scripts/ingest-off.ts`, read but not modified)

- `REQUIRE_MACROS` (`scripts/ingest-off.ts` line ~49, on by default): keep a
  row only if kcal, protein, carbs, and fat per-100g are all present (a real
  `0` counts as present). Mirrored in `02-macros-filter.sql`.
- `KEEP_COUNTRIES` (`scripts/ingest-off.ts` line ~40, defaults to
  `united-states`): keep a row if `countries_tags` has a tag matching
  `en:united-states` or ending in `:united-states`. Mirrored in
  `03-us-country-filter.sql`. **Not mirrored**: ingest-off.ts also has a
  barcode-prefix fallback (untagged + barcode starts with `0` => assume US)
  -- that's a GTIN heuristic, not meaningfully expressible as a single
  aggregate count; a commented-out variant approximating it is included at
  the bottom of `03-us-country-filter.sql` for reference.
- `04-combined-filter.sql` computes all of the above in one pass (macros,
  US-tagged, and both together) -- our best single-query estimate of what a
  fresh `--fresh` re-ingest would produce, before the additional
  category/name-pattern and Atwater-consistency filters in
  `ingest-off.ts` (those need row-level text matching not worth
  replicating here for a quick sanity check).

## Actual results (as of 2026-07-12)

| Query | Result |
|---|---|
| `01-total-row-count.sql` | **4,602,202** total rows (confirmed twice, consistent) |
| `02-macros-filter.sql` | **not obtained this run** -- see below |
| `03-us-country-filter.sql` | **not obtained this run** -- see below |
| `04-combined-filter.sql` | **not obtained this run** -- see below |

Only the total-row-count query was confirmed against the full dataset. The
other three queries require a full scan of the Parquet file's data pages
(the `nutriments`/`countries_tags` filters aren't satisfiable from metadata
alone), and every attempt to run them today hit persistent
`HTTP 429 Too Many Requests` from `huggingface.co` -- retried 6+ times with
exponential backoff (up to 4 minutes between attempts) without success. This
looks like an anonymous-access rate/bandwidth limit on Hugging Face's CDN for
this file, not a bug in the queries: a `LIMIT 20000` sanity-check subset
(first 20,000 rows in file order) ran fine and returned the expected shape
(18,734 of 20,000 rows had all four macros present), which is what validated
the `list_filter(...)."100g"` query pattern above -- but that's a
non-random, order-biased slice of the file, so it is **not** reported here as
a real macro-completeness rate.

**To get real numbers**: re-run `02`/`03`/`04` later (rate limits are usually
time-boxed) or with an `HF_TOKEN` / authenticated Hugging Face session if one
becomes available, which typically raises the anonymous rate limit.
