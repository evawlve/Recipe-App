-- Give IngredientFoodMap a FatSecret leg.
--
-- Until now the model could reference a legacy Food, an OffFood barcode, an FdcFood id or an
-- AiGeneratedFood — but NOT a FatSecret food, which is the mapper's most common winner
-- (autoMapIngredients logs itself as mode: 'fatsecret-only'). A FatSecret pick therefore had
-- nowhere to be stored and recipe auto-mapping could not complete for it.
--
-- Unlike offBarcode and fdcId, whose "FK →" comments are aspirational and carry no constraint,
-- this leg gets a REAL foreign key. The trade-off is deliberate and matches FoodMapping.fsId:
-- a FatSecret parent row is fetched on demand and is not guaranteed to be present, so without
-- the constraint a dangling reference would be silently written and only discovered when
-- something tried to read the food back. With it, the insert fails loudly at write time.
--
-- ON DELETE SET NULL rather than CASCADE: losing the cached FatSecret row should orphan the
-- link, not delete the user's ingredient mapping.
--
-- Stores the BARE FatSecret food_id — no "fs_" prefix. The mapper's foodId is `fs_<id>`;
-- FatSecretFood.fsId is `<id>`. Writing the prefixed form here reproduces exactly the class of
-- bug this table just had removed (`fatsecretFoodId: 'fdc:<id>'` aimed at a phantom column).

ALTER TABLE "IngredientFoodMap" ADD COLUMN "fsId" TEXT;

CREATE INDEX "IngredientFoodMap_fsId_idx" ON "IngredientFoodMap"("fsId");

ALTER TABLE "IngredientFoodMap"
  ADD CONSTRAINT "IngredientFoodMap_fsId_fkey"
  FOREIGN KEY ("fsId") REFERENCES "FatSecretFood"("fsId")
  ON DELETE SET NULL ON UPDATE CASCADE;
