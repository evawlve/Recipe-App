"use strict";
/**
 * USDA data normalization utilities
 * Re-uses existing normalizeUsdaRowToPer100g logic
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeUsdaRowToPer100g = normalizeUsdaRowToPer100g;
exports.fdcToUsdaRow = fdcToUsdaRow;
const serving_1 = require("@/lib/nutrition/serving");
/**
 * Normalize USDA row to per-100g nutrition data
 * Re-uses existing logic from @/lib/usda
 */
function normalizeUsdaRowToPer100g(row) {
    try {
        const { description, brand, nutrients } = row;
        // Extract basic nutrition values
        const kcal = nutrients.kcal || 0;
        const protein = nutrients.protein || 0;
        const carbs = nutrients.carbs || 0;
        const fat = nutrients.fat || 0;
        const fiber = nutrients.fiber || 0;
        const sugar = nutrients.sugar || 0;
        // Basic validation - must have calories
        if (kcal <= 0) {
            return null;
        }
        // Extract category hint from name and brand
        const categoryHint = (0, serving_1.extractCategoryHint)(description, brand);
        // Determine density based on category
        let densityGml;
        if (categoryHint === 'oil') {
            densityGml = 0.91;
        }
        else if (categoryHint === 'flour' || categoryHint === 'starch') {
            densityGml = 0.53;
        }
        else if (categoryHint === 'whey') {
            densityGml = 0.5;
        }
        else if (categoryHint === 'liquid') {
            densityGml = 1.0;
        }
        // Clamp values for oils and starches (prevent unrealistic values)
        const clampOil = (value) => {
            if (categoryHint === 'oil') {
                return Math.min(value, 100); // Oils can't be >100% fat
            }
            return value;
        };
        const clampStarch = (value) => {
            if (categoryHint === 'flour' || categoryHint === 'starch') {
                return Math.min(value, 100); // Starches can't be >100% carbs
            }
            return value;
        };
        // Drop zeros for cleaner data
        const cleanValue = (value) => value > 0 ? value : 0;
        return {
            name: description.trim(),
            brand: brand?.trim() || undefined,
            categoryId: categoryHint || undefined,
            densityGml,
            kcal100: cleanValue(kcal),
            protein100: cleanValue(clampOil(protein)),
            carbs100: cleanValue(clampStarch(carbs)),
            fat100: cleanValue(clampOil(fat)),
            fiber100: cleanValue(fiber) || undefined,
            sugar100: cleanValue(sugar) || undefined,
        };
    }
    catch (error) {
        console.warn('Failed to normalize USDA row:', error);
        return null;
    }
}
/**
 * Convert FDC food to UsdaRow format
 */
function fdcToUsdaRow(fdc) {
    try {
        const nutrients = {};
        // Extract nutrients from FDC format
        if (fdc.foodNutrients) {
            for (const fn of fdc.foodNutrients) {
                const nutrient = fn.nutrient;
                const amount = fn.amount || 0;
                switch (nutrient.number) {
                    case '208': // Energy (kcal)
                        nutrients.kcal = amount;
                        break;
                    case '203': // Protein
                        nutrients.protein = amount;
                        break;
                    case '205': // Carbohydrate
                        nutrients.carbs = amount;
                        break;
                    case '204': // Total lipid (fat)
                        nutrients.fat = amount;
                        break;
                    case '291': // Fiber
                        nutrients.fiber = amount;
                        break;
                    case '269': // Sugars
                        nutrients.sugar = amount;
                        break;
                }
            }
        }
        return {
            id: fdc.fdcId,
            description: fdc.description || '',
            brand: fdc.brandOwner || undefined,
            ingredients: fdc.ingredients || undefined,
            nutrients,
        };
    }
    catch (error) {
        console.warn('Failed to convert FDC to UsdaRow:', error);
        return null;
    }
}
