-- CreateTable
CREATE TABLE "MappingEventLog" (
    "id" TEXT NOT NULL,
    "rawLine" TEXT NOT NULL,
    "normalizedForm" TEXT,
    "cacheHit" TEXT,
    "cacheEscape" TEXT,
    "foodId" TEXT,
    "foodName" TEXT,
    "brandName" TEXT,
    "source" TEXT,
    "confidence" DOUBLE PRECISION,
    "servingTier" TEXT,
    "grams" DOUBLE PRECISION,
    "totalKcal" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "noCache" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MappingEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MappingEventLog_createdAt_idx" ON "MappingEventLog"("createdAt");

-- CreateIndex
CREATE INDEX "MappingEventLog_normalizedForm_idx" ON "MappingEventLog"("normalizedForm");

-- CreateIndex
CREATE INDEX "MappingEventLog_cacheHit_idx" ON "MappingEventLog"("cacheHit");

-- CreateIndex
CREATE INDEX "MappingEventLog_servingTier_idx" ON "MappingEventLog"("servingTier");
