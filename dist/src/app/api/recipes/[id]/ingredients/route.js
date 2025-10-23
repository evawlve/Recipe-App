"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const compute_1 = require("@/lib/nutrition/compute");
/**
 * Get all ingredients for a recipe (both mapped and unmapped)
 * GET /api/recipes/[id]/ingredients
 */
async function GET(req, { params }) {
    try {
        const user = await (0, auth_1.getCurrentUser)();
        if (!user?.id) {
            return server_1.NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const resolvedParams = await params;
        const recipeId = resolvedParams.id;
        if (!recipeId) {
            return server_1.NextResponse.json({ error: 'Recipe ID is required' }, { status: 400 });
        }
        // Verify user owns the recipe
        const recipe = await db_1.prisma.recipe.findFirst({
            where: { id: recipeId, authorId: user.id }
        });
        if (!recipe) {
            return server_1.NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
        }
        // Get all ingredients with their current mappings
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
        // Transform the data to include mapping status and nutrition
        const ingredientsWithMapping = ingredients.map(ingredient => {
            // Get the best mapping (highest confidence, active)
            const bestMapping = ingredient.foodMaps
                .filter(m => m.isActive)
                .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
            // Calculate nutrition if mapped
            let nutrition = null;
            if (bestMapping?.food) {
                const grams = (0, compute_1.convertUnit)(ingredient.qty, ingredient.unit, ingredient.name);
                const multiplier = grams / 100; // Convert to per-100g basis
                nutrition = {
                    calories: Math.round(bestMapping.food.kcal100 * multiplier),
                    proteinG: bestMapping.food.protein100 * multiplier,
                    carbsG: bestMapping.food.carbs100 * multiplier,
                    fatG: bestMapping.food.fat100 * multiplier,
                    fiberG: (bestMapping.food.fiber100 || 0) * multiplier,
                    sugarG: (bestMapping.food.sugar100 || 0) * multiplier,
                };
            }
            return {
                id: ingredient.id,
                name: ingredient.name,
                qty: ingredient.qty,
                unit: ingredient.unit,
                currentMapping: bestMapping ? {
                    foodId: bestMapping.foodId,
                    foodName: bestMapping.food.name,
                    foodBrand: bestMapping.food.brand,
                    confidence: bestMapping.confidence
                } : null,
                nutrition
            };
        });
        return server_1.NextResponse.json({
            success: true,
            data: ingredientsWithMapping
        });
    }
    catch (error) {
        console.error('Get ingredients error:', error);
        return server_1.NextResponse.json({ error: 'Failed to get ingredients' }, { status: 500 });
    }
}
