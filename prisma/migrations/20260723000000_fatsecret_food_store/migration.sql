-- FatSecret Premier retrieval-lane food store: lane hits persist locally
-- (FatSecretFood + FatSecretServing) so cache hits never touch the external
-- API; FoodMapping.fsId is the third source column alongside offBarcode/fdcId.

-- CreateTable
CREATE TABLE "FatSecretFood" (
    "fsId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandName" TEXT,
    "foodType" TEXT,
    "nutrientsPer100g" JSONB NOT NULL,
    "defaultServingId" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FatSecretFood_pkey" PRIMARY KEY ("fsId")
);

-- CreateTable
CREATE TABLE "FatSecretServing" (
    "id" TEXT NOT NULL,
    "fsId" TEXT NOT NULL,
    "servingId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "measurementDescription" TEXT,
    "grams" DOUBLE PRECISION,
    "volumeMl" DOUBLE PRECISION,
    "numberOfUnits" DOUBLE PRECISION,
    "nutrients" JSONB,

    CONSTRAINT "FatSecretServing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FatSecretFood_name_idx" ON "FatSecretFood"("name");

-- CreateIndex
CREATE INDEX "FatSecretFood_brandName_idx" ON "FatSecretFood"("brandName");

-- CreateIndex
CREATE INDEX "FatSecretFood_fetchedAt_idx" ON "FatSecretFood"("fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FatSecretServing_fsId_servingId_key" ON "FatSecretServing"("fsId", "servingId");

-- CreateIndex
CREATE INDEX "FatSecretServing_fsId_idx" ON "FatSecretServing"("fsId");

-- AddForeignKey
ALTER TABLE "FatSecretServing" ADD CONSTRAINT "FatSecretServing_fsId_fkey" FOREIGN KEY ("fsId") REFERENCES "FatSecretFood"("fsId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "FoodMapping" ADD COLUMN "fsId" TEXT;

-- CreateIndex
CREATE INDEX "FoodMapping_fsId_idx" ON "FoodMapping"("fsId");

-- AddForeignKey
ALTER TABLE "FoodMapping" ADD CONSTRAINT "FoodMapping_fsId_fkey" FOREIGN KEY ("fsId") REFERENCES "FatSecretFood"("fsId") ON DELETE SET NULL ON UPDATE CASCADE;
