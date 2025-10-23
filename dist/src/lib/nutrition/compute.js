"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertUnit = convertUnit;
exports.computeTotals = computeTotals;
exports.scoreV1 = scoreV1;
exports.computeRecipeNutrition = computeRecipeNutrition;
exports.getUnmappedIngredients = getUnmappedIngredients;
const db_1 = require("../db");
// import { FoodSource } from '@prisma/client'; // Not needed - source is just a string
const normalize_1 = require("./normalize");
const logger_1 = require("../logger");
const flags_1 = require("../flags");
const score_v2_1 = require("./score-v2");
// Unit conversion factors to grams
const UNIT_CONVERSIONS = {
    // Weight units
    'g': 1,
    'gram': 1,
    'grams': 1,
    'kg': 1000,
    'kilogram': 1000,
    'kilograms': 1000,
    'lb': 453.592,
    'pound': 453.592,
    'pounds': 453.592,
    'oz': 28.3495,
    'ounce': 28.3495,
    'ounces': 28.3495,
    // Volume units (approximate conversions to grams for common ingredients)
    'ml': 1, // assuming 1ml = 1g for most liquids
    'milliliter': 1,
    'milliliters': 1,
    'l': 1000,
    'liter': 1000,
    'liters': 1000,
    'cup': 240, // 1 cup ≈ 240ml ≈ 240g for water
    'cups': 240,
    'tbsp': 15, // 1 tablespoon ≈ 15ml ≈ 15g
    'tablespoon': 15,
    'tablespoons': 15,
    'tsp': 5, // 1 teaspoon ≈ 5ml ≈ 5g
    'teaspoon': 5,
    'teaspoons': 5,
    // Count units (approximate weights)
    'piece': 50, // average piece weight
    'pieces': 50,
    'slice': 25, // average slice weight
    'slices': 25,
    'scoop': 30, // typical protein powder scoop
    'scoops': 30, // typical protein powder scoop
    'medium': 150, // average medium item
    'large': 200, // average large item
    'small': 100, // average small item
};
/**
 * Convert ingredient quantity to grams based on unit using robust normalizer
 */
function convertUnit(qty, unit, ingredientName) {
    // Create a RawFood object for the normalizer
    const rawFood = {
        name: ingredientName || '',
        brand: null,
        servingSize: qty,
        servingSizeUnit: unit,
        gramWeight: null,
        categoryHint: ingredientName ? (0, normalize_1.extractCategoryHint)(ingredientName) : null
    };
    // Use the robust normalizer to get grams
    const grams = (0, normalize_1.servingToGrams)(rawFood);
    if (grams !== null && grams > 0) {
        return grams;
    }
    // Fallback to old conversion system for unknown cases
    const normalizedUnit = unit.toLowerCase().trim();
    const conversionFactor = UNIT_CONVERSIONS[normalizedUnit];
    if (conversionFactor === undefined) {
        // If unit is unknown, assume it's already in grams
        console.warn(`Unknown unit: ${unit}, assuming grams`);
        return qty;
    }
    return qty * conversionFactor;
}
/**
 * Compute nutrition totals for a recipe with provisional tracking
 */
async function computeTotals(recipeId) {
    const ingredients = await db_1.prisma.ingredient.findMany({
        where: { recipeId },
        include: {
            foodMaps: {
                include: {
                    food: true
                }
            }
        }
    });
    let totals = {
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        sugarG: 0
    };
    let totalCal = 0;
    let lowConfCal = 0;
    let unmappedCount = 0;
    for (const ingredient of ingredients) {
        // Convert ingredient quantity to grams using robust normalizer
        const grams = convertUnit(ingredient.qty, ingredient.unit, ingredient.name);
        // Find the best food mapping (highest confidence)
        const bestMapping = ingredient.foodMaps
            .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
        if (bestMapping?.food) {
            const food = bestMapping.food;
            const multiplier = grams / 100; // Convert to per-100g basis
            const ingredientCalories = food.kcal100 * multiplier;
            totals.calories += ingredientCalories;
            totals.proteinG += food.protein100 * multiplier;
            totals.carbsG += food.carbs100 * multiplier;
            totals.fatG += food.fat100 * multiplier;
            totals.fiberG += (food.fiber100 || 0) * multiplier;
            totals.sugarG += (food.sugar100 || 0) * multiplier;
            // Track calories for provisional calculation
            totalCal += ingredientCalories;
            // Check if this mapping is low confidence or use-once
            const isLowConfidence = (bestMapping.confidence || 0) < 0.5;
            const isUseOnce = bestMapping.useOnce || false;
            if (isLowConfidence || isUseOnce) {
                lowConfCal += ingredientCalories;
            }
        }
        else {
            unmappedCount++;
        }
    }
    // Calculate provisional status
    const lowShare = totalCal > 0 ? lowConfCal / totalCal : 0;
    const provisional = (unmappedCount > 0) || (lowShare >= 0.30);
    const provisionalReasons = [];
    if (unmappedCount > 0) {
        provisionalReasons.push(`${unmappedCount} unmapped ingredient${unmappedCount > 1 ? 's' : ''}`);
    }
    if (lowShare >= 0.30) {
        provisionalReasons.push(`${Math.round(lowShare * 100)}% from low-confidence mappings`);
    }
    // Round to reasonable precision
    return {
        calories: Math.round(totals.calories),
        proteinG: Math.round(totals.proteinG * 10) / 10,
        carbsG: Math.round(totals.carbsG * 10) / 10,
        fatG: Math.round(totals.fatG * 10) / 10,
        fiberG: Math.round(totals.fiberG * 10) / 10,
        sugarG: Math.round(totals.sugarG * 10) / 10,
        provisional: {
            provisional,
            provisionalReasons
        },
        lowConfidenceShare: Number(lowShare.toFixed(3)),
        unmappedCount
    };
}
/**
 * Calculate health score based on nutrition totals and goal
 */
function scoreV1(totals, goal = 'general') {
    const { calories, proteinG, carbsG, fatG, fiberG, sugarG } = totals;
    // Goal-specific scoring weights
    const goalWeights = {
        general: { protein: 0.3, carbs: 0.3, fat: 0.2, fiber: 0.1, sugar: 0.1 },
        weight_loss: { protein: 0.4, carbs: 0.2, fat: 0.2, fiber: 0.15, sugar: 0.05 },
        muscle_gain: { protein: 0.5, carbs: 0.3, fat: 0.15, fiber: 0.05, sugar: 0.0 },
        maintenance: { protein: 0.3, carbs: 0.3, fat: 0.25, fiber: 0.1, sugar: 0.05 }
    };
    const weights = goalWeights[goal];
    // Protein score (0-100): Higher protein is better
    const proteinScore = Math.min(100, (proteinG / calories * 1000) * 10);
    // Carb score (0-100): Moderate carbs are good, too high is bad
    const carbRatio = carbsG / calories * 1000;
    const carbScore = carbRatio < 0.6 ? 100 : Math.max(0, 100 - (carbRatio - 0.6) * 200);
    // Fat score (0-100): Moderate fat is good
    const fatRatio = fatG / calories * 1000;
    const fatScore = fatRatio < 0.3 ? 100 : Math.max(0, 100 - (fatRatio - 0.3) * 150);
    // Fiber score (0-100): Higher fiber is better
    const fiberScore = Math.min(100, fiberG * 10);
    // Sugar score (0-100): Lower sugar is better
    const sugarScore = Math.max(0, 100 - sugarG * 20);
    const breakdown = {
        proteinScore: Math.round(proteinScore),
        carbScore: Math.round(carbScore),
        fatScore: Math.round(fatScore),
        fiberScore: Math.round(fiberScore),
        sugarScore: Math.round(sugarScore)
    };
    const score = Math.round(breakdown.proteinScore * weights.protein +
        breakdown.carbScore * weights.carbs +
        breakdown.fatScore * weights.fat +
        breakdown.fiberScore * weights.fiber +
        breakdown.sugarScore * weights.sugar);
    return { value: score, label: 'Health Score', breakdown };
}
/**
 * Compute and save nutrition data for a recipe
 */
async function computeRecipeNutrition(recipeId, goal = 'general') {
    try {
        console.log('Starting nutrition computation for recipe:', recipeId);
        // Get all ingredients to check for unmapped ones
        const ingredients = await db_1.prisma.ingredient.findMany({
            where: { recipeId },
            include: {
                foodMaps: true
            }
        });
        console.log('Found', ingredients.length, 'ingredients');
        const unmappedIngredients = ingredients
            .filter(ing => ing.foodMaps.length === 0)
            .map(ing => ing.name);
        // Compute totals with provisional tracking
        const result = await computeTotals(recipeId);
        const { provisional, lowConfidenceShare, unmappedCount, ...totals } = result;
        // Calculate health score
        let score;
        if (flags_1.HEALTH_SCORE_V2) {
            const scoreV2Result = (0, score_v2_1.scoreV2)({
                calories: totals.calories,
                protein: totals.proteinG,
                carbs: totals.carbsG,
                fat: totals.fatG,
                fiber: totals.fiberG,
                sugar: totals.sugarG
            }, goal);
            score = scoreV2Result;
        }
        else {
            score = scoreV1(totals, goal);
            // Add label for v1 compatibility
            score.label = score.value >= 80 ? 'great' : score.value >= 60 ? 'good' : score.value >= 40 ? 'ok' : 'poor';
        }
        // Log provisional computation
        logger_1.logger.info('compute_provisional', {
            feature: 'mapping_v2',
            step: 'compute_provisional',
            recipeId,
            lowConfidenceShare,
            provisional: provisional.provisional,
            unmappedCount
        });
        // Save to database
        // Guard against NaN/Infinity values and ensure relation is satisfied on create
        const sanitize = (n) => (Number.isFinite(n) ? n : 0);
        console.log('Saving nutrition to database...');
        await db_1.prisma.nutrition.upsert({
            where: { recipeId },
            update: {
                calories: sanitize(totals.calories),
                proteinG: sanitize(totals.proteinG),
                carbsG: sanitize(totals.carbsG),
                fatG: sanitize(totals.fatG),
                fiberG: sanitize(totals.fiberG),
                sugarG: sanitize(totals.sugarG),
                healthScore: score.value,
                goal,
                computedAt: new Date()
            },
            create: {
                recipeId,
                calories: sanitize(totals.calories),
                proteinG: sanitize(totals.proteinG),
                carbsG: sanitize(totals.carbsG),
                fatG: sanitize(totals.fatG),
                fiberG: sanitize(totals.fiberG),
                sugarG: sanitize(totals.sugarG),
                healthScore: score.value,
                goal
            }
        });
        console.log('Nutrition saved successfully');
        return { totals, score, provisional, unmappedIngredients };
    }
    catch (error) {
        console.error('Error in computeRecipeNutrition:', error);
        throw error;
    }
}
/**
 * Get unmapped ingredients for a recipe
 */
async function getUnmappedIngredients(recipeId) {
    const ingredients = await db_1.prisma.ingredient.findMany({
        where: { recipeId },
        include: {
            foodMaps: true
        }
    });
    return ingredients
        .filter(ing => ing.foodMaps.length === 0)
        .map(ing => ({
        id: ing.id,
        name: ing.name,
        qty: ing.qty,
        unit: ing.unit
    }));
}
