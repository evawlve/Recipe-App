-- CreateTable
CREATE TABLE "FatSecretFoodCache" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandName" TEXT,
    "foodType" TEXT,
    "country" TEXT,
    "description" TEXT,
    "defaultServingId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'food.get.v4',
    "confidence" DOUBLE PRECISION DEFAULT 0.9,
    "nutrientsPer100g" JSONB,
    "legacyFoodId" TEXT,
    "hash" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FatSecretFoodCache_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FatSecretFoodCache_legacyFoodId_key" UNIQUE ("legacyFoodId")
);

-- CreateTable
CREATE TABLE "FatSecretDensityEstimate" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "densityGml" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FatSecretDensityEstimate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FatSecretDensityEstimate_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "FatSecretFoodCache"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FatSecretServingCache" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "measurementDescription" TEXT,
    "numberOfUnits" DOUBLE PRECISION,
    "metricServingAmount" DOUBLE PRECISION,
    "metricServingUnit" TEXT,
    "servingWeightGrams" DOUBLE PRECISION,
    "volumeMl" DOUBLE PRECISION,
    "isVolume" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "derivedViaDensity" BOOLEAN NOT NULL DEFAULT false,
    "densityEstimateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FatSecretServingCache_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FatSecretServingCache_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "FatSecretFoodCache"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FatSecretServingCache_densityEstimateId_fkey" FOREIGN KEY ("densityEstimateId") REFERENCES "FatSecretDensityEstimate"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FatSecretFoodAlias" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "locale" VARCHAR(16),
    "source" TEXT NOT NULL DEFAULT 'fatsecret',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FatSecretFoodAlias_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FatSecretFoodAlias_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "FatSecretFoodCache"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FatSecretCacheSyncRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalRequested" INTEGER NOT NULL DEFAULT 0,
    "totalHydrated" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "metadata" JSONB,

    CONSTRAINT "FatSecretCacheSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FatSecretFoodCache_syncedAt_idx" ON "FatSecretFoodCache"("syncedAt");

-- CreateIndex
CREATE INDEX "FatSecretFoodCache_expiresAt_idx" ON "FatSecretFoodCache"("expiresAt");

-- CreateIndex
CREATE INDEX "FatSecretFoodCache_hash_idx" ON "FatSecretFoodCache"("hash");

-- CreateIndex
CREATE INDEX "FatSecretServingCache_foodId_idx" ON "FatSecretServingCache"("foodId");

-- CreateIndex
CREATE INDEX "FatSecretServingCache_isDefault_idx" ON "FatSecretServingCache"("isDefault");

-- CreateIndex
CREATE INDEX "FatSecretServingCache_densityEstimateId_idx" ON "FatSecretServingCache"("densityEstimateId");

-- CreateIndex
CREATE UNIQUE INDEX "FatSecretFoodAlias_foodId_alias_key" ON "FatSecretFoodAlias"("foodId", "alias");

-- CreateIndex
CREATE INDEX "FatSecretFoodAlias_alias_idx" ON "FatSecretFoodAlias"("alias");

-- CreateIndex
CREATE INDEX "FatSecretDensityEstimate_foodId_idx" ON "FatSecretDensityEstimate"("foodId");

-- CreateIndex
CREATE INDEX "FatSecretDensityEstimate_source_idx" ON "FatSecretDensityEstimate"("source");

-- CreateIndex
CREATE INDEX "FatSecretCacheSyncRun_status_startedAt_idx" ON "FatSecretCacheSyncRun"("status", "startedAt");
