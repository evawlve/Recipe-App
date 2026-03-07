-- Migration: add_ai_generated_food
-- Adds AI-generated nutrition data tables as a last-resort fallback
-- for unmappable ingredients, and the FK on IngredientFoodMap.
-- NOTE: These tables were created directly on the DB before this migration
-- was written. Use `prisma migrate resolve --applied 20260306_add_ai_generated_food`
-- to mark it applied without re-running on existing environments.

-- AI-generated food nutrition (last-resort fallback)
CREATE TABLE "AiGeneratedFood" (
    "id" TEXT NOT NULL,
    "ingredientName" TEXT NOT NULL,
    "rawLine" TEXT,
    "displayName" TEXT NOT NULL,
    "caloriesPer100g" DOUBLE PRECISION NOT NULL,
    "proteinPer100g" DOUBLE PRECISION NOT NULL,
    "carbsPer100g" DOUBLE PRECISION NOT NULL,
    "fatPer100g" DOUBLE PRECISION NOT NULL,
    "fiberPer100g" DOUBLE PRECISION DEFAULT 0,
    "sugarPer100g" DOUBLE PRECISION DEFAULT 0,
    "sodiumMgPer100g" DOUBLE PRECISION DEFAULT 0,
    "saturatedFatPer100g" DOUBLE PRECISION DEFAULT 0,
    "cholesterolMgPer100g" DOUBLE PRECISION DEFAULT 0,
    "aiConfidence" DOUBLE PRECISION NOT NULL,
    "aiModel" TEXT NOT NULL,
    "aiNotes" TEXT,
    "baseFoodName" TEXT,
    "baseFoodSource" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "useCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiGeneratedFood_pkey" PRIMARY KEY ("id")
);

-- Serving estimates for AI-generated foods
CREATE TABLE "AiGeneratedServing" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "grams" DOUBLE PRECISION NOT NULL,
    "volumeMl" DOUBLE PRECISION,
    "aiConfidence" DOUBLE PRECISION NOT NULL,
    "aiNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGeneratedServing_pkey" PRIMARY KEY ("id")
);

-- FK on IngredientFoodMap for AI-generated foods
ALTER TABLE "IngredientFoodMap" ADD COLUMN "aiGeneratedFoodId" TEXT;

-- Unique + index constraints
CREATE UNIQUE INDEX "AiGeneratedFood_ingredientName_key" ON "AiGeneratedFood"("ingredientName");
CREATE INDEX "AiGeneratedFood_ingredientName_idx" ON "AiGeneratedFood"("ingredientName");
CREATE INDEX "AiGeneratedFood_reviewStatus_idx" ON "AiGeneratedFood"("reviewStatus");
CREATE INDEX "AiGeneratedFood_createdAt_idx" ON "AiGeneratedFood"("createdAt" DESC);
CREATE UNIQUE INDEX "AiGeneratedServing_foodId_label_key" ON "AiGeneratedServing"("foodId", "label");
CREATE INDEX "AiGeneratedServing_foodId_idx" ON "AiGeneratedServing"("foodId");
CREATE INDEX "IngredientFoodMap_aiGeneratedFoodId_idx" ON "IngredientFoodMap"("aiGeneratedFoodId");

-- FK constraints
ALTER TABLE "AiGeneratedServing" ADD CONSTRAINT "AiGeneratedServing_foodId_fkey"
    FOREIGN KEY ("foodId") REFERENCES "AiGeneratedFood"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IngredientFoodMap" ADD CONSTRAINT "IngredientFoodMap_aiGeneratedFoodId_fkey"
    FOREIGN KEY ("aiGeneratedFoodId") REFERENCES "AiGeneratedFood"("id") ON DELETE SET NULL ON UPDATE CASCADE;
