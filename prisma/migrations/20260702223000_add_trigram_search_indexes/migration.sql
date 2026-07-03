-- Enable the PostgreSQL trigram extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GIN (Generalized Inverted Index) indexes on the description and name columns
CREATE INDEX IF NOT EXISTS fdc_foods_name_trgm_idx ON public."FdcFood" USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS off_foods_name_trgm_idx ON public."OffFood" USING gin (name gin_trgm_ops);
