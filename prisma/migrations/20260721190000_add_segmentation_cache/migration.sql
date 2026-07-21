-- Segmentation-result cache (magic-log): repeat free-text lines skip the ~2-4s
-- LLM split. Keyed by canonicalized line (src/lib/nlp/seg-line-key.ts) plus
-- SEG_PARSER_VERSION (src/lib/nlp/ai-segmenter.ts) — a version bump orphans old
-- rows (never read again); the sliding 30d TTL on "lastUsedAt" garbage-collects
-- them (opportunistic sweep in src/lib/nlp/segmentation-cache.ts). Only
-- successful, complete LLM segmentations are ever written.

-- CreateTable
CREATE TABLE "SegmentationCache" (
    "lineKey" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "segmentsJson" JSONB NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SegmentationCache_pkey" PRIMARY KEY ("lineKey","parserVersion")
);

-- CreateIndex
CREATE INDEX "SegmentationCache_lastUsedAt_idx" ON "SegmentationCache"("lastUsedAt");

-- CreateIndex
CREATE INDEX "SegmentationCache_hitCount_idx" ON "SegmentationCache"("hitCount");

-- AlterTable: per-request segmentation-cache outcome on telemetry rows
-- (true = served from cache, false = AI segmentation ran, NULL = the line
-- never reached AI segmentation — item-form input or single-item fast path).
ALTER TABLE "MappingEventLog" ADD COLUMN "segCacheHit" BOOLEAN;
