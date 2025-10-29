-- CreateTable
CREATE TABLE "RecipeSimilar" (
    "recipeId" TEXT NOT NULL,
    "similarId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipeSimilar_pkey" PRIMARY KEY ("recipeId","similarId")
);

-- CreateIndex
CREATE INDEX "RecipeSimilar_recipeId_score_idx" ON "RecipeSimilar"("recipeId", "score");

-- CreateIndex
CREATE INDEX "RecipeSimilar_similarId_idx" ON "RecipeSimilar"("similarId");

-- AddForeignKey
ALTER TABLE "RecipeSimilar" ADD CONSTRAINT "RecipeSimilar_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeSimilar" ADD CONSTRAINT "RecipeSimilar_similarId_fkey" FOREIGN KEY ("similarId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
