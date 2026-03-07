-- CreateEnum
CREATE TYPE "TagNamespace" AS ENUM ('MEAL_TYPE', 'CUISINE', 'DIET', 'METHOD', 'COURSE', 'TIME', 'DIFFICULTY', 'OCCASION', 'GOAL');

-- CreateEnum
CREATE TYPE "TagSource" AS ENUM ('USER', 'AUTO_CONFIDENT', 'AUTO_SUGGESTED');

-- CreateEnum
CREATE TYPE "PatternType" AS ENUM ('MEASUREMENT_PREFIX', 'MEASUREMENT_SUFFIX', 'PREP_PHRASE', 'SIZE_PHRASE', 'PARSING_ARTIFACT', 'BRAND_NAME', 'REDUNDANT_WORDS');

-- CreateEnum
CREATE TYPE "PatternSource" AS ENUM ('AI_LEARNED', 'MANUAL', 'AUTO_DETECTED', 'USER_FEEDBACK');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "avatarUrl" TEXT,
    "avatarKey" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "username" TEXT,
    "displayName" TEXT,
    "bio" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyMd" TEXT NOT NULL,
    "servings" INTEGER NOT NULL DEFAULT 1,
    "prepTime" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nutrition" (
    "recipeId" TEXT NOT NULL,
    "calories" INTEGER NOT NULL,
    "proteinG" DOUBLE PRECISION NOT NULL,
    "carbsG" DOUBLE PRECISION NOT NULL,
    "fatG" DOUBLE PRECISION NOT NULL,
    "fiberG" DOUBLE PRECISION DEFAULT 0,
    "sugarG" DOUBLE PRECISION DEFAULT 0,
    "healthScore" DOUBLE PRECISION DEFAULT 0,
    "goal" TEXT DEFAULT 'general',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Nutrition_pkey" PRIMARY KEY ("recipeId")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "isMainPhoto" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "namespace" "TagNamespace" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeTag" (
    "recipeId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "source" "TagSource" NOT NULL DEFAULT 'USER',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,

    CONSTRAINT "RecipeTag_pkey" PRIMARY KEY ("recipeId","tagId")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Like" (
    "userId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Like_pkey" PRIMARY KEY ("userId","recipeId")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionRecipe" (
    "collectionId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionRecipe_pkey" PRIMARY KEY ("collectionId","recipeId")
);

-- CreateTable
CREATE TABLE "Follow" (
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("followerId","followingId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "recipeId" TEXT,
    "commentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "bumpedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Food" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" VARCHAR(120),
    "categoryId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'usda',
    "verification" TEXT NOT NULL DEFAULT 'unverified',
    "densityGml" DOUBLE PRECISION,
    "kcal100" DOUBLE PRECISION NOT NULL,
    "protein100" DOUBLE PRECISION NOT NULL,
    "carbs100" DOUBLE PRECISION NOT NULL,
    "fat100" DOUBLE PRECISION NOT NULL,
    "fiber100" DOUBLE PRECISION,
    "sugar100" DOUBLE PRECISION,
    "popularity" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Food_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FdcFoodCache" (
    "id" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "brandName" TEXT,
    "dataType" TEXT NOT NULL,
    "nutrients" JSONB NOT NULL,
    "servingSize" DOUBLE PRECISION,
    "servingSizeUnit" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FdcFoodCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FdcServingCache" (
    "id" SERIAL NOT NULL,
    "fdcId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "grams" DOUBLE PRECISION NOT NULL,
    "volumeMl" DOUBLE PRECISION,
    "derivedViaDensity" BOOLEAN NOT NULL DEFAULT false,
    "densityGml" DOUBLE PRECISION,
    "prepModifier" TEXT,
    "source" TEXT NOT NULL DEFAULT 'fdc',
    "isAiEstimated" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "note" TEXT,

    CONSTRAINT "FdcServingCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FatSecretFoodCache" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandName" TEXT,
    "foodType" TEXT,
    "country" TEXT,
    "description" TEXT,
    "defaultServingId" TEXT,
    "source" TEXT DEFAULT 'food.get.v4',
    "confidence" DOUBLE PRECISION DEFAULT 0.9,
    "nutrientsPer100g" JSONB,
    "legacyFoodId" TEXT,
    "hash" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FatSecretFoodCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FatSecretServingCache" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "measurementDescription" TEXT,
    "numberOfUnits" DOUBLE PRECISION,
    "metricServingAmount" DOUBLE PRECISION,
    "metricServingUnit" TEXT,
    "servingWeightGrams" DOUBLE PRECISION,
    "volumeMl" DOUBLE PRECISION,
    "isVolume" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "derivedViaDensity" BOOLEAN NOT NULL DEFAULT false,
    "densityEstimateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT DEFAULT 'fatsecret',
    "confidence" DOUBLE PRECISION,
    "note" TEXT,

    CONSTRAINT "FatSecretServingCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FatSecretFoodAlias" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "locale" VARCHAR(16),
    "source" TEXT DEFAULT 'fatsecret',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FatSecretFoodAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FatSecretDensityEstimate" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "densityGml" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FatSecretDensityEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FatSecretCacheSyncRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalRequested" INTEGER NOT NULL DEFAULT 0,
    "totalHydrated" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "metadata" JSONB,

    CONSTRAINT "FatSecretCacheSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodUnit" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "grams" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "FoodUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Barcode" (
    "id" TEXT NOT NULL,
    "gtin" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,

    CONSTRAINT "Barcode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientFoodMap" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "foodId" TEXT,
    "fatsecretFoodId" TEXT,
    "fatsecretServingId" TEXT,
    "fatsecretGrams" DOUBLE PRECISION,
    "fatsecretConfidence" DOUBLE PRECISION,
    "fatsecretSource" TEXT,
    "aiGeneratedFoodId" TEXT,
    "pendingVolume" BOOLEAN NOT NULL DEFAULT false,
    "mappedBy" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "useOnce" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngredientFoodMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodAlias" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,

    CONSTRAINT "FoodAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortionOverride" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "grams" DOUBLE PRECISION NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPortionOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "grams" DOUBLE PRECISION NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPortionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeFeatureLite" (
    "recipeId" TEXT NOT NULL,
    "proteinPer100kcal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carbPer100kcal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fatPer100kcal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fiberPerServing" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sugarPerServing" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "kcalPerServing" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ingredientCount" INTEGER NOT NULL DEFAULT 0,
    "goalScores" TEXT NOT NULL DEFAULT '{}',
    "methodFlags" TEXT NOT NULL DEFAULT '[]',
    "cuisineScores" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipeFeatureLite_pkey" PRIMARY KEY ("recipeId")
);

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

-- CreateTable
CREATE TABLE "RecipeSimilar" (
    "recipeId" TEXT NOT NULL,
    "similarId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipeSimilar_pkey" PRIMARY KEY ("recipeId","similarId")
);

-- CreateTable
CREATE TABLE "GlobalIngredientMapping" (
    "id" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "fatsecretFoodId" TEXT,
    "fatsecretServingId" TEXT,
    "fdcId" INTEGER,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 1,
    "lastUsed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "isUserOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlobalIngredientMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientCleanupPattern" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "patternType" "PatternType" NOT NULL,
    "replacement" TEXT NOT NULL,
    "description" TEXT,
    "source" "PatternSource" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "successRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngredientCleanupPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientCleanupApplication" (
    "id" TEXT NOT NULL,
    "rawInput" TEXT NOT NULL,
    "cleanedOutput" TEXT NOT NULL,
    "patternId" TEXT NOT NULL,
    "recipeId" TEXT,
    "ingredientId" TEXT,
    "mappingSucceeded" BOOLEAN,
    "confidenceScore" DOUBLE PRECISION,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngredientCleanupApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidatedMapping" (
    "id" TEXT NOT NULL,
    "rawIngredient" TEXT NOT NULL,
    "normalizedForm" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "foodName" TEXT NOT NULL,
    "brandName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'fatsecret',
    "aiConfidence" DOUBLE PRECISION NOT NULL,
    "validationReason" TEXT,
    "isAlias" BOOLEAN NOT NULL DEFAULT false,
    "canonicalRawIngredient" TEXT,
    "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedBy" TEXT NOT NULL DEFAULT 'ai',
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValidatedMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MappingValidationFailure" (
    "id" TEXT NOT NULL,
    "rawIngredient" TEXT NOT NULL,
    "attemptedFoodId" TEXT NOT NULL,
    "attemptedFoodName" TEXT NOT NULL,
    "ourConfidence" DOUBLE PRECISION NOT NULL,
    "aiConfidence" DOUBLE PRECISION NOT NULL,
    "aiRejectionReason" TEXT NOT NULL,
    "aiFailureCategory" TEXT NOT NULL,
    "failureType" TEXT NOT NULL,
    "aiSuggestedAlternative" TEXT,
    "retrySucceeded" BOOLEAN,
    "scoringDetails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MappingValidationFailure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiNormalizeCache" (
    "normalizedKey" TEXT NOT NULL,
    "rawLine" TEXT,
    "normalizedName" TEXT NOT NULL,
    "canonicalBase" TEXT,
    "synonyms" JSONB NOT NULL DEFAULT '[]',
    "prepPhrases" JSONB NOT NULL DEFAULT '[]',
    "sizePhrases" JSONB NOT NULL DEFAULT '[]',
    "cookingModifier" TEXT,
    "estimatedCaloriesPer100g" DOUBLE PRECISION,
    "estimatedProteinPer100g" DOUBLE PRECISION,
    "estimatedCarbsPer100g" DOUBLE PRECISION,
    "estimatedFatPer100g" DOUBLE PRECISION,
    "nutritionConfidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "useCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiNormalizeCache_pkey" PRIMARY KEY ("normalizedKey")
);

-- CreateTable
CREATE TABLE "SearchQueryPattern" (
    "id" TEXT NOT NULL,
    "rawIngredient" TEXT NOT NULL,
    "searchQuery" TEXT NOT NULL,
    "suggestedQuery" TEXT,
    "detectedIssues" JSONB NOT NULL DEFAULT '[]',
    "aiReason" TEXT NOT NULL,
    "aiCategory" TEXT NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchQueryPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnedSynonym" (
    "id" TEXT NOT NULL,
    "sourceTerm" TEXT NOT NULL,
    "targetTerm" TEXT NOT NULL,
    "locale" VARCHAR(16),
    "category" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ai',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearnedSynonym_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Recipe_createdAt_idx" ON "Recipe"("createdAt");

-- CreateIndex
CREATE INDEX "Photo_recipeId_isMainPhoto_idx" ON "Photo"("recipeId", "isMainPhoto");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "RecipeTag_tagId_idx" ON "RecipeTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_userId_name_key" ON "Collection"("userId", "name");

-- CreateIndex
CREATE INDEX "Follow_followerId_idx" ON "Follow"("followerId");

-- CreateIndex
CREATE INDEX "Follow_followingId_idx" ON "Follow"("followingId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_bumpedAt_idx" ON "Notification"("userId", "bumpedAt");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_follow" ON "Notification"("userId", "actorId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_like" ON "Notification"("userId", "actorId", "type", "recipeId");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_comment" ON "Notification"("userId", "type", "commentId");

-- CreateIndex
CREATE INDEX "Food_name_idx" ON "Food"("name");

-- CreateIndex
CREATE INDEX "Food_brand_idx" ON "Food"("brand");

-- CreateIndex
CREATE INDEX "Food_source_idx" ON "Food"("source");

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

-- CreateIndex
CREATE UNIQUE INDEX "Food_name_brand_key" ON "Food"("name", "brand");

-- CreateIndex
CREATE INDEX "FdcFoodCache_syncedAt_idx" ON "FdcFoodCache"("syncedAt");

-- CreateIndex
CREATE INDEX "FdcFoodCache_expiresAt_idx" ON "FdcFoodCache"("expiresAt");

-- CreateIndex
CREATE INDEX "FdcServingCache_fdcId_idx" ON "FdcServingCache"("fdcId");

-- CreateIndex
CREATE INDEX "FdcServingCache_prepModifier_idx" ON "FdcServingCache"("prepModifier");

-- CreateIndex
CREATE UNIQUE INDEX "FdcServingCache_fdcId_description_key" ON "FdcServingCache"("fdcId", "description");

-- CreateIndex
CREATE UNIQUE INDEX "FatSecretFoodCache_legacyFoodId_key" ON "FatSecretFoodCache"("legacyFoodId");

-- CreateIndex
CREATE INDEX "FatSecretFoodCache_syncedAt_idx" ON "FatSecretFoodCache"("syncedAt");

-- CreateIndex
CREATE INDEX "FatSecretFoodCache_expiresAt_idx" ON "FatSecretFoodCache"("expiresAt");

-- CreateIndex
CREATE INDEX "FatSecretFoodCache_hash_idx" ON "FatSecretFoodCache"("hash");

-- CreateIndex
CREATE INDEX "FatSecretServingCache_foodId_idx" ON "FatSecretServingCache"("foodId");

-- CreateIndex
CREATE INDEX "FatSecretServingCache_isDefault_idx" ON "FatSecretServingCache"("isDefault");

-- CreateIndex
CREATE INDEX "FatSecretServingCache_densityEstimateId_idx" ON "FatSecretServingCache"("densityEstimateId");

-- CreateIndex
CREATE INDEX "FatSecretFoodAlias_alias_idx" ON "FatSecretFoodAlias"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "FatSecretFoodAlias_foodId_alias_key" ON "FatSecretFoodAlias"("foodId", "alias");

-- CreateIndex
CREATE INDEX "FatSecretDensityEstimate_foodId_idx" ON "FatSecretDensityEstimate"("foodId");

-- CreateIndex
CREATE INDEX "FatSecretDensityEstimate_source_idx" ON "FatSecretDensityEstimate"("source");

-- CreateIndex
CREATE INDEX "FatSecretCacheSyncRun_status_startedAt_idx" ON "FatSecretCacheSyncRun"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Barcode_gtin_key" ON "Barcode"("gtin");

-- CreateIndex
CREATE INDEX "IngredientFoodMap_ingredientId_idx" ON "IngredientFoodMap"("ingredientId");

-- CreateIndex
CREATE INDEX "IngredientFoodMap_foodId_idx" ON "IngredientFoodMap"("foodId");

-- CreateIndex
CREATE INDEX "IngredientFoodMap_fatsecretFoodId_idx" ON "IngredientFoodMap"("fatsecretFoodId");

-- CreateIndex
CREATE INDEX "IngredientFoodMap_aiGeneratedFoodId_idx" ON "IngredientFoodMap"("aiGeneratedFoodId");

-- CreateIndex
CREATE INDEX "FoodAlias_foodId_idx" ON "FoodAlias"("foodId");

-- CreateIndex
CREATE INDEX "FoodAlias_alias_idx" ON "FoodAlias"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "FoodAlias_foodId_alias_key" ON "FoodAlias"("foodId", "alias");

-- CreateIndex
CREATE INDEX "PortionOverride_unit_idx" ON "PortionOverride"("unit");

-- CreateIndex
CREATE UNIQUE INDEX "PortionOverride_foodId_unit_key" ON "PortionOverride"("foodId", "unit");

-- CreateIndex
CREATE INDEX "UserPortionOverride_userId_foodId_idx" ON "UserPortionOverride"("userId", "foodId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPortionOverride_userId_foodId_unit_key" ON "UserPortionOverride"("userId", "foodId", "unit");

-- CreateIndex
CREATE INDEX "RecipeView_recipeId_createdAt_idx" ON "RecipeView"("recipeId", "createdAt");

-- CreateIndex
CREATE INDEX "RecipeView_sessionId_createdAt_idx" ON "RecipeView"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "RecipeInteractionDaily_score_idx" ON "RecipeInteractionDaily"("score");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeInteractionDaily_recipeId_day_key" ON "RecipeInteractionDaily"("recipeId", "day");

-- CreateIndex
CREATE INDEX "RecipeSimilar_recipeId_score_idx" ON "RecipeSimilar"("recipeId", "score");

-- CreateIndex
CREATE INDEX "RecipeSimilar_similarId_idx" ON "RecipeSimilar"("similarId");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalIngredientMapping_normalizedName_key" ON "GlobalIngredientMapping"("normalizedName");

-- CreateIndex
CREATE INDEX "GlobalIngredientMapping_normalizedName_idx" ON "GlobalIngredientMapping"("normalizedName");

-- CreateIndex
CREATE INDEX "GlobalIngredientMapping_confidence_idx" ON "GlobalIngredientMapping"("confidence");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientCleanupPattern_pattern_key" ON "IngredientCleanupPattern"("pattern");

-- CreateIndex
CREATE INDEX "IngredientCleanupPattern_patternType_idx" ON "IngredientCleanupPattern"("patternType");

-- CreateIndex
CREATE INDEX "IngredientCleanupPattern_source_idx" ON "IngredientCleanupPattern"("source");

-- CreateIndex
CREATE INDEX "IngredientCleanupPattern_confidence_idx" ON "IngredientCleanupPattern"("confidence");

-- CreateIndex
CREATE INDEX "IngredientCleanupPattern_successRate_idx" ON "IngredientCleanupPattern"("successRate");

-- CreateIndex
CREATE INDEX "IngredientCleanupApplication_patternId_idx" ON "IngredientCleanupApplication"("patternId");

-- CreateIndex
CREATE INDEX "IngredientCleanupApplication_mappingSucceeded_idx" ON "IngredientCleanupApplication"("mappingSucceeded");

-- CreateIndex
CREATE INDEX "IngredientCleanupApplication_appliedAt_idx" ON "IngredientCleanupApplication"("appliedAt");

-- CreateIndex
CREATE INDEX "ValidatedMapping_rawIngredient_idx" ON "ValidatedMapping"("rawIngredient");

-- CreateIndex
CREATE INDEX "ValidatedMapping_normalizedForm_idx" ON "ValidatedMapping"("normalizedForm");

-- CreateIndex
CREATE INDEX "ValidatedMapping_isAlias_canonicalRawIngredient_idx" ON "ValidatedMapping"("isAlias", "canonicalRawIngredient");

-- CreateIndex
CREATE INDEX "ValidatedMapping_foodId_idx" ON "ValidatedMapping"("foodId");

-- CreateIndex
CREATE INDEX "ValidatedMapping_lastUsedAt_idx" ON "ValidatedMapping"("lastUsedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ValidatedMapping_rawIngredient_source_key" ON "ValidatedMapping"("rawIngredient", "source");

-- CreateIndex
CREATE UNIQUE INDEX "ValidatedMapping_normalizedForm_source_key" ON "ValidatedMapping"("normalizedForm", "source");

-- CreateIndex
CREATE INDEX "MappingValidationFailure_aiFailureCategory_idx" ON "MappingValidationFailure"("aiFailureCategory");

-- CreateIndex
CREATE INDEX "MappingValidationFailure_failureType_idx" ON "MappingValidationFailure"("failureType");

-- CreateIndex
CREATE INDEX "MappingValidationFailure_rawIngredient_idx" ON "MappingValidationFailure"("rawIngredient");

-- CreateIndex
CREATE INDEX "MappingValidationFailure_createdAt_idx" ON "MappingValidationFailure"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AiNormalizeCache_lastUsedAt_idx" ON "AiNormalizeCache"("lastUsedAt" DESC);

-- CreateIndex
CREATE INDEX "SearchQueryPattern_aiCategory_idx" ON "SearchQueryPattern"("aiCategory");

-- CreateIndex
CREATE INDEX "SearchQueryPattern_occurrences_idx" ON "SearchQueryPattern"("occurrences" DESC);

-- CreateIndex
CREATE INDEX "SearchQueryPattern_createdAt_idx" ON "SearchQueryPattern"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SearchQueryPattern_searchQuery_aiCategory_key" ON "SearchQueryPattern"("searchQuery", "aiCategory");

-- CreateIndex
CREATE INDEX "LearnedSynonym_sourceTerm_idx" ON "LearnedSynonym"("sourceTerm");

-- CreateIndex
CREATE INDEX "LearnedSynonym_successCount_idx" ON "LearnedSynonym"("successCount" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "LearnedSynonym_sourceTerm_targetTerm_key" ON "LearnedSynonym"("sourceTerm", "targetTerm");

-- CreateIndex
CREATE UNIQUE INDEX "AiGeneratedFood_ingredientName_key" ON "AiGeneratedFood"("ingredientName");

-- CreateIndex
CREATE INDEX "AiGeneratedFood_ingredientName_idx" ON "AiGeneratedFood"("ingredientName");

-- CreateIndex
CREATE INDEX "AiGeneratedFood_reviewStatus_idx" ON "AiGeneratedFood"("reviewStatus");

-- CreateIndex
CREATE INDEX "AiGeneratedFood_createdAt_idx" ON "AiGeneratedFood"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AiGeneratedServing_foodId_idx" ON "AiGeneratedServing"("foodId");

-- CreateIndex
CREATE UNIQUE INDEX "AiGeneratedServing_foodId_label_key" ON "AiGeneratedServing"("foodId", "label");

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nutrition" ADD CONSTRAINT "Nutrition_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeTag" ADD CONSTRAINT "RecipeTag_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeTag" ADD CONSTRAINT "RecipeTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionRecipe" ADD CONSTRAINT "CollectionRecipe_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionRecipe" ADD CONSTRAINT "CollectionRecipe_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FdcServingCache" ADD CONSTRAINT "FdcServingCache_fdcId_fkey" FOREIGN KEY ("fdcId") REFERENCES "FdcFoodCache"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FatSecretServingCache" ADD CONSTRAINT "FatSecretServingCache_densityEstimateId_fkey" FOREIGN KEY ("densityEstimateId") REFERENCES "FatSecretDensityEstimate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FatSecretServingCache" ADD CONSTRAINT "FatSecretServingCache_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "FatSecretFoodCache"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FatSecretFoodAlias" ADD CONSTRAINT "FatSecretFoodAlias_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "FatSecretFoodCache"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FatSecretDensityEstimate" ADD CONSTRAINT "FatSecretDensityEstimate_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "FatSecretFoodCache"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodUnit" ADD CONSTRAINT "FoodUnit_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Barcode" ADD CONSTRAINT "Barcode_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientFoodMap" ADD CONSTRAINT "IngredientFoodMap_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientFoodMap" ADD CONSTRAINT "IngredientFoodMap_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientFoodMap" ADD CONSTRAINT "IngredientFoodMap_aiGeneratedFoodId_fkey" FOREIGN KEY ("aiGeneratedFoodId") REFERENCES "AiGeneratedFood"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodAlias" ADD CONSTRAINT "FoodAlias_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortionOverride" ADD CONSTRAINT "PortionOverride_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPortionOverride" ADD CONSTRAINT "UserPortionOverride_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPortionOverride" ADD CONSTRAINT "UserPortionOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeFeatureLite" ADD CONSTRAINT "RecipeFeatureLite_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeView" ADD CONSTRAINT "RecipeView_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeView" ADD CONSTRAINT "RecipeView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeInteractionDaily" ADD CONSTRAINT "RecipeInteractionDaily_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeSimilar" ADD CONSTRAINT "RecipeSimilar_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeSimilar" ADD CONSTRAINT "RecipeSimilar_similarId_fkey" FOREIGN KEY ("similarId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientCleanupApplication" ADD CONSTRAINT "IngredientCleanupApplication_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "IngredientCleanupPattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGeneratedServing" ADD CONSTRAINT "AiGeneratedServing_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "AiGeneratedFood"("id") ON DELETE CASCADE ON UPDATE CASCADE;
