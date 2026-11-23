-- s464 A-CAT-1: USDA's own food category on every FdcFood row.
-- Nullable, catalog-only on PG 16, no rewrite. Backfilled by scripts/backfill-fdc-category.ts.
-- lock_timeout fails fast instead of queueing behind a long reader.
SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "FdcFood" ADD COLUMN "foodCategory" TEXT;
