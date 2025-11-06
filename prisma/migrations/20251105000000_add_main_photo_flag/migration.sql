-- AlterTable
ALTER TABLE "Photo" ADD COLUMN "isMainPhoto" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Photo_recipeId_isMainPhoto_idx" ON "Photo"("recipeId", "isMainPhoto");

-- Set the first photo of each recipe as the main photo
WITH first_photos AS (
  SELECT DISTINCT ON ("recipeId") id, "recipeId"
  FROM "Photo"
  ORDER BY "recipeId", id
)
UPDATE "Photo"
SET "isMainPhoto" = true
FROM first_photos
WHERE "Photo".id = first_photos.id;

