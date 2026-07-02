-- Enable Row Level Security on all 34 tables that had it disabled

ALTER TABLE "AiGeneratedFood" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiGeneratedServing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiNormalizeCache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Barcode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DailyLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FatSecretCacheSyncRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FatSecretDensityEstimate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FatSecretFoodAlias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FatSecretFoodCache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FatSecretServingCache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FdcFoodCache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FdcServingCache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Food" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FoodAlias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FoodUnit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GlobalIngredientMapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ingredient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IngredientCleanupApplication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IngredientCleanupPattern" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IngredientFoodMap" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LearnedSynonym" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LogEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MappingValidationFailure" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Nutrition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpenFoodFactsCache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpenFoodFactsServingCache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Photo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PortionOverride" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Recipe" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SearchQueryPattern" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserPortionOverride" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ValidatedMapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- Drop existing conflicting policies for core tables to ensure idempotent run
DROP POLICY IF EXISTS "Users can view own profile" ON "User";
DROP POLICY IF EXISTS "Users can update own profile" ON "User";
DROP POLICY IF EXISTS "Users can create own profile" ON "User";
DROP POLICY IF EXISTS "Anyone can view recipes" ON "Recipe";
DROP POLICY IF EXISTS "Users can create recipes" ON "Recipe";
DROP POLICY IF EXISTS "Users can update own recipes" ON "Recipe";
DROP POLICY IF EXISTS "Users can delete own recipes" ON "Recipe";
DROP POLICY IF EXISTS "Anyone can view ingredients" ON "Ingredient";
DROP POLICY IF EXISTS "Users can manage ingredients for own recipes" ON "Ingredient";
DROP POLICY IF EXISTS "Anyone can view nutrition" ON "Nutrition";
DROP POLICY IF EXISTS "Users can manage nutrition for own recipes" ON "Nutrition";
DROP POLICY IF EXISTS "Anyone can view photos" ON "Photo";
DROP POLICY IF EXISTS "Users can manage photos for own recipes" ON "Photo";

-- Create policies for core tables

-- User table policies
CREATE POLICY "Users can view own profile" ON "User"
  FOR SELECT USING (auth.uid()::text = id);

CREATE POLICY "Users can update own profile" ON "User"
  FOR UPDATE USING (auth.uid()::text = id);

CREATE POLICY "Users can create own profile" ON "User"
  FOR INSERT WITH CHECK (auth.uid()::text = id);

-- Recipe table policies
CREATE POLICY "Anyone can view recipes" ON "Recipe"
  FOR SELECT USING (true);

CREATE POLICY "Users can create recipes" ON "Recipe"
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL AND 
    (auth.uid()::text = "authorId" OR 
     EXISTS (SELECT 1 FROM "User" WHERE id = auth.uid()::text))
  );

CREATE POLICY "Users can update own recipes" ON "Recipe"
  FOR UPDATE USING (auth.uid()::text = "authorId");

CREATE POLICY "Users can delete own recipes" ON "Recipe"
  FOR DELETE USING (auth.uid()::text = "authorId");

-- Ingredient table policies
CREATE POLICY "Anyone can view ingredients" ON "Ingredient"
  FOR SELECT USING (true);

CREATE POLICY "Users can manage ingredients for own recipes" ON "Ingredient"
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM "Recipe" 
      WHERE "Recipe".id = "Ingredient"."recipeId" 
      AND "Recipe"."authorId" = auth.uid()::text
    )
  );

-- Nutrition table policies
CREATE POLICY "Anyone can view nutrition" ON "Nutrition"
  FOR SELECT USING (true);

CREATE POLICY "Users can manage nutrition for own recipes" ON "Nutrition"
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM "Recipe" 
      WHERE "Recipe".id = "Nutrition"."recipeId" 
      AND "Recipe"."authorId" = auth.uid()::text
    )
  );

-- Photo table policies
CREATE POLICY "Anyone can view photos" ON "Photo"
  FOR SELECT USING (true);

CREATE POLICY "Users can manage photos for own recipes" ON "Photo"
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM "Recipe" 
      WHERE "Recipe".id = "Photo"."recipeId" 
      AND "Recipe"."authorId" = auth.uid()::text
    )
  );
