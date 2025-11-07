/*
  Warnings:

  - A unique constraint covering the columns `[userId,actorId,type]` on the table `Notification` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,actorId,type,recipeId]` on the table `Notification` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,type,commentId]` on the table `Notification` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "recipe_tag_composite_idx";

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "bumpedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "prepTime" TEXT;

-- CreateIndex
CREATE INDEX "Notification_userId_bumpedAt_idx" ON "Notification"("userId", "bumpedAt");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_follow" ON "Notification"("userId", "actorId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_like" ON "Notification"("userId", "actorId", "type", "recipeId");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_comment" ON "Notification"("userId", "type", "commentId");
