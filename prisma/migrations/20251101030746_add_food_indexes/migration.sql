-- CreateIndex
CREATE INDEX "Food_verification_idx" ON "Food"("verification");

-- CreateIndex
CREATE INDEX "Food_categoryId_idx" ON "Food"("categoryId");

-- CreateIndex
CREATE INDEX "Food_createdAt_idx" ON "Food"("createdAt");

-- CreateIndex
CREATE INDEX "Food_popularity_idx" ON "Food"("popularity");

-- CreateIndex
CREATE INDEX "Food_verification_source_idx" ON "Food"("verification", "source");

-- CreateIndex
CREATE INDEX "Food_categoryId_verification_idx" ON "Food"("categoryId", "verification");
