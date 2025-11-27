-- CreateTable: AI-Validated Ingredient Mappings
CREATE TABLE "ValidatedMapping" (
    "id" TEXT NOT NULL,
    "rawIngredient" TEXT NOT NULL,
    "normalizedForm" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "foodName" TEXT NOT NULL,
    "brandName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'fatsecret',
    "aiConfidence" DOUBLE PRECISION NOT NULL,
    "validationReason" TEXT,
    "isAlias" BOOLEAN NOT NULL DEFAULT false,
    "canonicalRawIngredient" TEXT,
    "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedBy" TEXT NOT NULL DEFAULT 'ai',
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValidatedMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Mapping Validation Failures
CREATE TABLE "MappingValidationFailure" (
    "id" TEXT NOT NULL,
    "rawIngredient" TEXT NOT NULL,
    "attemptedFoodId" TEXT NOT NULL,
    "attemptedFoodName" TEXT NOT NULL,
    "ourConfidence" DOUBLE PRECISION NOT NULL,
    "aiConfidence" DOUBLE PRECISION NOT NULL,
    "aiRejectionReason" TEXT NOT NULL,
    "aiFailureCategory" TEXT NOT NULL,
    "failureType" TEXT NOT NULL,
    "aiSuggestedAlternative" TEXT,
    "retrySucceeded" BOOLEAN,
    "scoringDetails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MappingValidationFailure_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AI Normalize Cache
CREATE TABLE "AiNormalizeCache" (
    "rawLine" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "synonyms" JSONB NOT NULL DEFAULT '[]',
    "prepPhrases" JSONB NOT NULL DEFAULT '[]',
    "sizePhrases" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "useCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiNormalizeCache_pkey" PRIMARY KEY ("rawLine")
);

-- CreateIndex
CREATE UNIQUE INDEX "ValidatedMapping_rawIngredient_source_key" ON "ValidatedMapping"("rawIngredient", "source");

-- CreateIndex
CREATE INDEX "ValidatedMapping_rawIngredient_idx" ON "ValidatedMapping"("rawIngredient");

-- CreateIndex
CREATE INDEX "ValidatedMapping_normalizedForm_idx" ON "ValidatedMapping"("normalizedForm");

-- CreateIndex
CREATE INDEX "ValidatedMapping_isAlias_canonicalRawIngredient_idx" ON "ValidatedMapping"("isAlias", "canonicalRawIngredient");

-- CreateIndex
CREATE INDEX "ValidatedMapping_foodId_idx" ON "ValidatedMapping"("foodId");

-- CreateIndex
CREATE INDEX "ValidatedMapping_lastUsedAt_idx" ON "ValidatedMapping"("lastUsedAt" DESC);

-- CreateIndex
CREATE INDEX "MappingValidationFailure_aiFailureCategory_idx" ON "MappingValidationFailure"("aiFailureCategory");

-- CreateIndex
CREATE INDEX "MappingValidationFailure_failureType_idx" ON "MappingValidationFailure"("failureType");

-- CreateIndex
CREATE INDEX "MappingValidationFailure_rawIngredient_idx" ON "MappingValidationFailure"("rawIngredient");

-- CreateIndex
CREATE INDEX "MappingValidationFailure_createdAt_idx" ON "MappingValidationFailure"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AiNormalizeCache_lastUsedAt_idx" ON "AiNormalizeCache"("lastUsedAt" DESC);
