-- Enable pgvector (idempotent; already created on the Mini-PC, present here for fresh DBs)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add nullable 384-dim embedding column for semantic search (bge-small-en-v1.5).
-- Nullable so delta-ingested rows land with NULL and simply don't participate in
-- vector search until embedded; keyword search still finds them.
ALTER TABLE "OffFood" ADD COLUMN "embedding" vector(384);
