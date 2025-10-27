-- AlterTable
ALTER TABLE "RecipeFeatureLite" ADD COLUMN     "ingredientCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RecipeView" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecipeView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeInteractionDaily" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "RecipeInteractionDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecipeView_recipeId_createdAt_idx" ON "RecipeView"("recipeId", "createdAt");

-- CreateIndex
CREATE INDEX "RecipeView_sessionId_createdAt_idx" ON "RecipeView"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "RecipeInteractionDaily_score_idx" ON "RecipeInteractionDaily"("score");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeInteractionDaily_recipeId_day_key" ON "RecipeInteractionDaily"("recipeId", "day");

-- AddForeignKey
ALTER TABLE "RecipeView" ADD CONSTRAINT "RecipeView_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeView" ADD CONSTRAINT "RecipeView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeInteractionDaily" ADD CONSTRAINT "RecipeInteractionDaily_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
