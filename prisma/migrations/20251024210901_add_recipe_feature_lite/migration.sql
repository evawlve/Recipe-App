-- CreateTable
CREATE TABLE "RecipeFeatureLite" (
    "recipeId" TEXT NOT NULL,
    "proteinPer100kcal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carbPer100kcal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fatPer100kcal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fiberPerServing" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sugarPerServing" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "kcalPerServing" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "goalScores" TEXT NOT NULL DEFAULT '{}',
    "methodFlags" TEXT NOT NULL DEFAULT '[]',
    "cuisineScores" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipeFeatureLite_pkey" PRIMARY KEY ("recipeId")
);

-- AddForeignKey
ALTER TABLE "RecipeFeatureLite" ADD CONSTRAINT "RecipeFeatureLite_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
