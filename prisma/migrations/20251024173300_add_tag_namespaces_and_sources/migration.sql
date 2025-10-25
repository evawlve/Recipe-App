/*
  Warnings:

  - Added the required column `namespace` to the `Tag` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TagNamespace" AS ENUM ('MEAL_TYPE', 'CUISINE', 'DIET', 'METHOD', 'COURSE', 'TIME', 'DIFFICULTY', 'OCCASION', 'GOAL');

-- CreateEnum
CREATE TYPE "TagSource" AS ENUM ('USER', 'AUTO_CONFIDENT', 'AUTO_SUGGESTED');

-- AlterTable
ALTER TABLE "RecipeTag" ADD COLUMN     "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
ADD COLUMN     "source" "TagSource" NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "namespace" "TagNamespace";

-- Set default namespace for existing tags
UPDATE "Tag" SET "namespace" = 'MEAL_TYPE' WHERE "namespace" IS NULL;

-- Make namespace NOT NULL after setting defaults
ALTER TABLE "Tag" ALTER COLUMN "namespace" SET NOT NULL;
