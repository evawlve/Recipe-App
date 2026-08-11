-- CreateTable
CREATE TABLE "MappingValidationVerdict" (
    "id" TEXT NOT NULL,
    "normalizedForm" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "axis" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "billedGrams" DOUBLE PRECISION NOT NULL,
    "billedKcal" DOUBLE PRECISION NOT NULL,
    "servingTier" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MappingValidationVerdict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MappingValidationVerdict_normalizedForm_idx" ON "MappingValidationVerdict"("normalizedForm");

-- CreateIndex
CREATE INDEX "MappingValidationVerdict_verdict_idx" ON "MappingValidationVerdict"("verdict");

-- CreateIndex
CREATE INDEX "MappingValidationVerdict_createdAt_idx" ON "MappingValidationVerdict"("createdAt");

