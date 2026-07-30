-- Persist the multi-component signal that aiNormalizeIngredient() already computes.
-- The LLM returns is_multi_ingredient / split_ingredients on every normalize call, but
-- AiNormalizeCache had no column for either, so the detection survived only for the life
-- of one request and was re-derived (or lost) on every cache hit.
--
-- Both columns are additive. isMultiIngredient defaults to false so pre-existing rows —
-- which were written before the signal was persisted and cannot be backfilled without a
-- re-run of the LLM — read as "not known to be multi-component", the same answer the
-- dead `(cached as any).isMultiIngredient ?? false` read gave before this migration.
-- splitIngredients is nullable rather than defaulting to '[]': null means "never asked",
-- an empty array would mean "asked, and there are no components".

ALTER TABLE "AiNormalizeCache" ADD COLUMN "isMultiIngredient" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AiNormalizeCache" ADD COLUMN "splitIngredients" JSONB;
