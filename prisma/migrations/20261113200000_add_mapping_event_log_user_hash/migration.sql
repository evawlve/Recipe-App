-- s457 UID-1; catalog-only on PG 16, no rewrite.
-- no index: the deletion UPDATE is a serial seq scan of ~76 MB
-- (EXPLAIN 2026-11-13; the 21 ms read was a parallel SELECT).
-- lock_timeout fails fast instead of queueing parse telemetry behind a long reader.
SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "MappingEventLog" ADD COLUMN "userHash" TEXT;
