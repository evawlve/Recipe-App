-- Add metadata columns to FatSecretServingCache so we can flag AI/manual entries
ALTER TABLE "FatSecretServingCache"
  ADD COLUMN "source" TEXT DEFAULT 'fatsecret',
  ADD COLUMN "confidence" DOUBLE PRECISION,
  ADD COLUMN "note" TEXT;

CREATE INDEX IF NOT EXISTS "FatSecretServingCache_source_idx" ON "FatSecretServingCache"("source");
