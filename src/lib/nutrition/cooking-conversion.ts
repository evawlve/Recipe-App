/**
 * Cooking Conversion Utility
 * 
 * Applies USDA-based cooking conversion factors to raw ingredient macros
 * when FatSecret/FDC lacks explicitly-labeled cooked variants.
 * 
 * Conversion factors based on:
 * - USDA Table of Cooking Yields for Meat and Poultry
 * - General estimation: ~25% water loss for meats, ~200% water gain for grains
 */

import { logger } from '../logger';

// ============================================================
// Types
// ============================================================

export interface RawMacros {
    kcalPer100g: number;
    proteinPer100g: number;
    carbsPer100g: number;
    fatPer100g: number;
}

export interface CookedMacros extends RawMacros {
    conversionFactor: number;
    cookingCategory: CookingCategory;
}

export type CookingCategory =
    | 'meat_poultry'      // Chicken, turkey, beef, pork, lamb
    | 'seafood'           // Fish, shrimp, shellfish
    | 'eggs'              // Eggs (minimal change)
    | 'grains_pasta'      // Rice, pasta, quinoa (water absorption)
    | 'legumes'           // Beans, lentils (water absorption)
    | 'vegetables'        // Spinach, potatoes, etc.
    | 'none';             // No conversion needed

// ============================================================
// Cooking Conversion Factors
// ============================================================

/**
 * Macro-level conversion factors (multiply raw kcal/100g by this factor)
 * 
 * Water loss (meats) → calories concentrate → factor > 1
 * Water gain (grains) → calories dilute → factor < 1
 */
export const COOKING_CONVERSION_FACTORS: Record<CookingCategory, number> = {
    // Meats lose ~25% water weight → calories concentrate by ~33%
    'meat_poultry': 1.33,
    'seafood': 1.25,        // Slightly less water loss than meat

    // Eggs lose minimal water (~10%)
    'eggs': 1.10,

    // Grains/pasta absorb ~2-3x their weight in water
    'grains_pasta': 0.33,   // Cooked has 1/3 the cal/100g of dry
    'legumes': 0.50,        // Beans absorb ~2x water

    // Vegetables vary widely, use conservative estimate
    'vegetables': 0.90,     // Slight water loss

    // No conversion
    'none': 1.0,
};

// ============================================================
// Food Category Detection
// ============================================================

// Foods where cooking state matters - organized by cooking category
const COOKING_CATEGORY_FOODS: Record<CookingCategory, string[]> = {
    'meat_poultry': [
        'chicken', 'chicken breast', 'chicken thigh', 'chicken leg', 'chicken wing',
        'turkey', 'turkey breast', 'duck', 'goose',
        'beef', 'steak', 'ground beef', 'beef tenderloin', 'sirloin', 'ribeye',
        'filet mignon', 'brisket', 'roast beef',
        'pork', 'pork chop', 'pork loin', 'pork tenderloin', 'bacon', 'ham',
        'pork belly', 'pork shoulder',
        'lamb', 'lamb chop', 'veal', 'venison', 'bison', 'goat',
        'sausage', 'bratwurst', 'chorizo',
    ],
    'seafood': [
        'salmon', 'tuna', 'cod', 'tilapia', 'halibut', 'trout', 'fish', 'fish fillet',
        'shrimp', 'prawns', 'lobster', 'crab', 'scallops',
        'mussels', 'clams', 'oysters', 'calamari', 'squid',
    ],
    'eggs': [
        'egg', 'eggs',
    ],
    'grains_pasta': [
        'quinoa', 'rice', 'pasta', 'oatmeal', 'oats', 'barley',
        'couscous', 'bulgur', 'farro', 'millet', 'sorghum',
        'buckwheat', 'spelt', 'kamut', 'freekeh', 'wheat berries',
        'noodles', 'spaghetti', 'macaroni', 'penne', 'fusilli',
    ],
    'legumes': [
        'lentils', 'lentil', 'beans', 'chickpeas', 'peas',
        'black beans', 'kidney beans', 'pinto beans', 'navy beans',
    ],
    'vegetables': [
        'potato', 'potatoes', 'sweet potato', 'yam',
        'spinach', 'kale', 'broccoli', 'cauliflower',
        'carrots', 'carrot', 'beets', 'beet',
    ],
    'none': [],
};

/**
 * Detect the cooking category for a normalized ingredient name
 */
export function getCookingCategory(normalizedName: string): CookingCategory {
    const lower = normalizedName.toLowerCase();

    // Check each category in order of specificity
    for (const [category, foods] of Object.entries(COOKING_CATEGORY_FOODS)) {
        if (category === 'none') continue;

        for (const food of foods) {
            if (lower.includes(food)) {
                return category as CookingCategory;
            }
        }
    }

    return 'none';
}

/**
 * Check if a food needs cooking conversion
 */
export function needsCookingConversion(normalizedName: string): boolean {
    return getCookingCategory(normalizedName) !== 'none';
}

// ============================================================
// Cooking Conversion
// ============================================================

/**
 * Apply cooking conversion factor to raw macros
 * 
 * @param rawMacros - Nutrition data for raw/dry ingredient
 * @param normalizedName - Normalized ingredient name (to detect category)
 * @returns Adjusted macros for cooked state
 */
export function applyCookingConversion(
    rawMacros: RawMacros,
    normalizedName: string
): CookedMacros {
    const category = getCookingCategory(normalizedName);
    const factor = COOKING_CONVERSION_FACTORS[category];

    logger.info('cooking_conversion.applied', {
        normalizedName,
        category,
        factor,
        rawKcal: rawMacros.kcalPer100g,
        cookedKcal: Math.round(rawMacros.kcalPer100g * factor),
    });

    return {
        kcalPer100g: Math.round(rawMacros.kcalPer100g * factor),
        proteinPer100g: Math.round(rawMacros.proteinPer100g * factor * 10) / 10,
        carbsPer100g: Math.round(rawMacros.carbsPer100g * factor * 10) / 10,
        fatPer100g: Math.round(rawMacros.fatPer100g * factor * 10) / 10,
        conversionFactor: factor,
        cookingCategory: category,
    };
}
