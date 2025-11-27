-- Migration: Add Ingredient Cleanup Pattern System
-- Date: 2024-11-24
-- Description: Add tables for learning-based ingredient name cleanup patterns
-- Apply this via Supabase SQL Editor

-- ============================================================================
-- CREATE ENUMS
-- ============================================================================

-- Pattern Type: Categories of cleanup patterns
CREATE TYPE "PatternType" AS ENUM (
  'MEASUREMENT_PREFIX',
  'MEASUREMENT_SUFFIX',
  'PREP_PHRASE',
  'SIZE_PHRASE',
  'PARSING_ARTIFACT',
  'BRAND_NAME',
  'REDUNDANT_WORDS'
);

-- Pattern Source: How we learned the pattern
CREATE TYPE "PatternSource" AS ENUM (
  'AI_LEARNED',
  'MANUAL',
  'AUTO_DETECTED',
  'USER_FEEDBACK'
);

-- ============================================================================
-- CREATE TABLES
-- ============================================================================

-- Table: IngredientCleanupPattern
-- Stores cleanup patterns learned from AI or added manually
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

-- Table: IngredientCleanupApplication
-- Tracks each time a pattern is applied to an ingredient
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

-- ============================================================================
-- CREATE INDEXES
-- ============================================================================

-- IngredientCleanupPattern indexes
CREATE UNIQUE INDEX "IngredientCleanupPattern_pattern_key" ON "IngredientCleanupPattern"("pattern");
CREATE INDEX "IngredientCleanupPattern_patternType_idx" ON "IngredientCleanupPattern"("patternType");
CREATE INDEX "IngredientCleanupPattern_source_idx" ON "IngredientCleanupPattern"("source");
CREATE INDEX "IngredientCleanupPattern_confidence_idx" ON "IngredientCleanupPattern"("confidence");
CREATE INDEX "IngredientCleanupPattern_successRate_idx" ON "IngredientCleanupPattern"("successRate");

-- IngredientCleanupApplication indexes
CREATE INDEX "IngredientCleanupApplication_patternId_idx" ON "IngredientCleanupApplication"("patternId");
CREATE INDEX "IngredientCleanupApplication_mappingSucceeded_idx" ON "IngredientCleanupApplication"("mappingSucceeded");
CREATE INDEX "IngredientCleanupApplication_appliedAt_idx" ON "IngredientCleanupApplication"("appliedAt");

-- ============================================================================
-- CREATE FOREIGN KEY CONSTRAINTS
-- ============================================================================

ALTER TABLE "IngredientCleanupApplication" 
ADD CONSTRAINT "IngredientCleanupApplication_patternId_fkey" 
FOREIGN KEY ("patternId") 
REFERENCES "IngredientCleanupPattern"("id") 
ON DELETE CASCADE 
ON UPDATE CASCADE;

-- ============================================================================
-- SEED INITIAL PATTERNS
-- ============================================================================

-- Insert initial cleanup patterns that fix known issues
INSERT INTO "IngredientCleanupPattern" (
  "id",
  "pattern",
  "patternType",
  "replacement",
  "description",
  "source",
  "confidence",
  "usageCount",
  "successCount",
  "failureCount",
  "createdAt",
  "lastUsed"
) VALUES
  (
    'pattern_meas_tbsp_' || gen_random_uuid()::text,
    '^(\d+\s*)?(tbsps?|tablespoons?)\s+',
    'MEASUREMENT_PREFIX',
    '',
    'Remove tablespoon prefix (e.g., "2 tbsps ginger" → "ginger")',
    'MANUAL',
    1.0,
    0,
    0,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'pattern_meas_tsp_' || gen_random_uuid()::text,
    '^(\d+\s*)?(tsps?|teaspoons?)\s+',
    'MEASUREMENT_PREFIX',
    '',
    'Remove teaspoon prefix (e.g., "2 tsps ginger" → "ginger")',
    'MANUAL',
    1.0,
    0,
    0,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'pattern_meas_cup_' || gen_random_uuid()::text,
    '^(\d+\s*)?(cups?)\s+',
    'MEASUREMENT_PREFIX',
    '',
    'Remove cup prefix',
    'MANUAL',
    1.0,
    0,
    0,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'pattern_artifact_bone_' || gen_random_uuid()::text,
    '\b(bone and skin removed)\b',
    'PARSING_ARTIFACT',
    '',
    'Remove "bone and skin removed" phrase',
    'MANUAL',
    1.0,
    0,
    0,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'pattern_prep_cut_' || gen_random_uuid()::text,
    '\b(cut into strips|cut into)\b',
    'PREP_PHRASE',
    '',
    'Remove cutting directions',
    'MANUAL',
    0.9,
    0,
    0,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'pattern_artifact_yields_' || gen_random_uuid()::text,
    '\b(yields)\s+',
    'PARSING_ARTIFACT',
    '',
    'Remove "yields" keyword',
    'MANUAL',
    1.0,
    0,
    0,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'pattern_prep_divided_' || gen_random_uuid()::text,
    '\b(divided)\b',
    'PREP_PHRASE',
    '',
    'Remove "divided" instruction',
    'MANUAL',
    0.9,
    0,
    0,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'pattern_prep_common_' || gen_random_uuid()::text,
    '\b(diced|chopped|minced|sliced)\b',
    'PREP_PHRASE',
    '',
    'Remove common prep words',
    'MANUAL',
    0.85,
    0,
    0,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'pattern_size_desc_' || gen_random_uuid()::text,
    '\b(large|medium|small)\b',
    'SIZE_PHRASE',
    '',
    'Remove size descriptors (handled by AI if needed)',
    'MANUAL',
    0.7,
    0,
    0,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- After running this migration, execute the following INSERT statement
-- to record it in the _prisma_migrations table:

/*
INSERT INTO "_prisma_migrations" (
  "id",
  "checksum",
  "finished_at",
  "migration_name",
  "logs",
  "rolled_back_at",
  "started_at",
  "applied_steps_count"
) VALUES (
  'manual_20241124_cleanup_patterns',
  'checksum_manual_20241124_cleanup_system',
  NOW(),
  '20241124184000_add_ingredient_cleanup_patterns',
  '',
  NULL,
  NOW(),
  1
);
*/
