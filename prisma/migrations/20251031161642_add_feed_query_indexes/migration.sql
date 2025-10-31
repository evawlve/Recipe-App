-- CreateIndex
-- Index for feed queries: filters by createdAt >= date and orders by createdAt DESC
-- Used by /api/feed/foryou and other feed endpoints that query recipes by creation date
CREATE INDEX "Recipe_createdAt_idx" ON "Recipe"("createdAt");

-- CreateIndex
-- Index for tag filtering queries: efficiently find all recipes with a specific tag
-- Used by tags: { some: { tagId: id }} filters in recipe queries (e.g., src/lib/recipes/query.ts)
CREATE INDEX "RecipeTag_tagId_idx" ON "RecipeTag"("tagId");

