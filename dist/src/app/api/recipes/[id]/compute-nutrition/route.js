"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const compute_1 = require("@/lib/nutrition/compute");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
/**
 * Compute nutrition for a specific recipe
 * POST /api/recipes/[id]/compute-nutrition
 * Body: { goal?: string }
 */
async function POST(req, { params }) {
    try {
        const user = await (0, auth_1.getCurrentUser)();
        if (!user?.id) {
            return server_1.NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const { goal = 'general' } = await req.json();
        const resolvedParams = await params;
        const recipeId = resolvedParams.id;
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
        console.error('Recipe nutrition computation error:', error);
        return server_1.NextResponse.json({ error: 'Failed to compute recipe nutrition' }, { status: 500 });
    }
}
