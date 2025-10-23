"use strict";
/**
 * Helper functions for serving size calculations and density conversions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.gramsForMeasure = gramsForMeasure;
exports.calculatePerServingCalories = calculatePerServingCalories;
exports.extractCategoryHint = extractCategoryHint;
const units_1 = require("./units");
/**
 * Get grams for a given unit and category hint
 * Enhanced with unit normalization and better category detection
 */
function gramsForMeasure(unit, categoryHint) {
    // Normalize unit synonyms
    const normalizedUnit = (0, units_1.normalizeUnit)(unit);
    const cat = categoryHint.toLowerCase();
    const pick = (m) => cat.includes('oil') ? m.oil :
        cat.includes('liquid') ? m.water :
            cat.includes('flour') || cat.includes('starch') ? m.flour : null;
    if (normalizedUnit === 'tsp')
        return pick({ oil: 4.5, water: 4.9, flour: 2.5 }) ?? null;
    if (normalizedUnit === 'tbsp')
        return pick({ oil: 13.6, water: 14.7, flour: 8.0 }) ?? null;
    if (normalizedUnit === 'cup')
        return (cat.includes('oil') ? 216 :
            cat.includes('liquid') ? 240 :
                cat.includes('flour') ? 120 :
                    cat.includes('sugar') ? 200 :
                        cat.includes('rice') ? 185 :
                            cat.includes('oat') ? 90 : null);
    if (normalizedUnit === 'g' || normalizedUnit === 'gram' || normalizedUnit === 'grams')
        return 1;
    if (normalizedUnit === 'ml')
        return 1; // water-like default
    return null;
}
/**
 * Calculate per-serving calories from per-100g data
 */
function calculatePerServingCalories(per100gCalories, quantity, unit, categoryHint) {
    const gramsPerUnit = gramsForMeasure(unit, categoryHint);
    if (!gramsPerUnit)
        return null;
    const totalGrams = quantity * gramsPerUnit;
    return Math.round(per100gCalories * totalGrams / 100);
}
/**
 * Extract category hint from food name/brand
 * Enhanced with better pattern matching
 */
function extractCategoryHint(name, brand) {
    const text = `${name} ${brand || ''}`.toLowerCase();
    if (/oil|olive|canola|avocado|sunflower|sesame|vegetable oil|palm oil|coconut oil/i.test(text))
        return "oil";
    if (/water|milk|broth|stock|liquid/i.test(text))
        return "liquid";
    if (/flour|starch|corn starch|almond flour|coconut flour|corn grain/i.test(text))
        return "flour";
    if (/sugar|granulated sugar|brown sugar/i.test(text))
        return "sugar";
    if (/rice|white rice|brown rice/i.test(text))
        return "rice";
    if (/oat|rolled oats|steel cut oats/i.test(text))
        return "oats";
    return null;
}
