"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
exports.GET = GET;
const server_1 = require("next/server");
const compute_1 = require("@/lib/nutrition/compute");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
/**
 * Compute nutrition for a recipe
 * POST /api/nutrition
 * Body: { recipeId: string, goal?: string }
 */
async function POST(req) {
    try {
        const user = await (0, auth_1.getCurrentUser)();
        if (!user?.id) {
            return server_1.NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const { recipeId, goal = 'general' } = await req.json();
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
        const result = await (0, compute_1.computeRecipeNutrition)(recipeId, goal);
        return server_1.NextResponse.json({
            success: true,
            data: result
        });
    }
    catch (error) {
        console.error('Nutrition computation error:', error);
        return server_1.NextResponse.json({ error: 'Failed to compute nutrition' }, { status: 500 });
    }
}
/**
 * Get unmapped ingredients for a recipe
 * GET /api/nutrition?recipeId=...
 */
async function GET(req) {
    try {
        const user = await (0, auth_1.getCurrentUser)();
        if (!user?.id) {
            return server_1.NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const { searchParams } = new URL(req.url);
        const recipeId = searchParams.get('recipeId');
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
        const unmappedIngredients = await (0, compute_1.getUnmappedIngredients)(recipeId);
        // Also get existing nutrition data if it exists
        const existingNutrition = await db_1.prisma.nutrition.findUnique({
            where: { recipeId }
        });
        let nutritionData = null;
        if (existingNutrition) {
            // If nutrition exists, compute the current totals and score
            const { computeTotals, scoreV1 } = await Promise.resolve().then(() => __importStar(require('@/lib/nutrition/compute')));
            const { HEALTH_SCORE_V2 } = await Promise.resolve().then(() => __importStar(require('@/lib/flags')));
            const { scoreV2 } = await Promise.resolve().then(() => __importStar(require('@/lib/nutrition/score-v2')));
            const result = await computeTotals(recipeId);
            const { provisional, ...totals } = result;
            let score;
            if (HEALTH_SCORE_V2) {
                const scoreV2Result = scoreV2({
                    calories: totals.calories,
                    protein: totals.proteinG,
                    carbs: totals.carbsG,
                    fat: totals.fatG,
                    fiber: totals.fiberG,
                    sugar: totals.sugarG
                }, existingNutrition.goal);
                score = scoreV2Result;
            }
            else {
                score = scoreV1(totals, existingNutrition.goal);
                // Add label for v1 compatibility
                score.label = score.value >= 80 ? 'great' : score.value >= 60 ? 'good' : score.value >= 40 ? 'ok' : 'poor';
            }
            nutritionData = {
                totals,
                score,
                provisional,
                unmappedIngredients
            };
        }
        else {
            nutritionData = {
                totals: null,
                score: null,
                unmappedIngredients
            };
        }
        return server_1.NextResponse.json({
            success: true,
            data: nutritionData
        });
    }
    catch (error) {
        console.error('Get unmapped ingredients error:', error);
        return server_1.NextResponse.json({ error: 'Failed to get unmapped ingredients' }, { status: 500 });
    }
}
