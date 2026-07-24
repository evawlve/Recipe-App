-- Add canonicalBase + cookingModifier observability/grouping columns to FoodMapping.
-- These are additive and nullable; the @id lookup key (normalizedForm) is unchanged.
-- canonicalBase is the AI-derived base identity (prep/size stripped, brand + nutrition
-- modifiers preserved) used for dedup/grouping/analytics, never as a lookup key.

ALTER TABLE "FoodMapping" ADD COLUMN "canonicalBase" TEXT;
ALTER TABLE "FoodMapping" ADD COLUMN "cookingModifier" TEXT;

CREATE INDEX "FoodMapping_canonicalBase_idx" ON "FoodMapping"("canonicalBase");
