"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const auto_map_1 = require("@/lib/nutrition/auto-map");
const compute_1 = require("@/lib/nutrition/compute");
/**
 * Manually trigger auto-mapping for a recipe
 * POST /api/recipes/[id]/auto-map
 */
async function POST(req, { params }) {
    try {
        const { id } = await params;
        // Get the authenticated user
        const user = await (0, auth_1.getCurrentUser)();
        if (!user?.id) {
            return server_1.NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        // Verify user owns the recipe
        const recipe = await db_1.prisma.recipe.findFirst({
            where: { id, authorId: user.id }
        });
        if (!recipe) {
            return server_1.NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
        }
        // Run auto-mapping
        const mappedCount = await (0, auto_map_1.autoMapIngredients)(id);
        // Compute nutrition after mapping
        await (0, compute_1.computeRecipeNutrition)(id, 'general');
        return server_1.NextResponse.json({
            success: true,
            mappedCount,
            message: `Auto-mapped ${mappedCount} ingredients`
        });
    }
    catch (error) {
        console.error('Auto-mapping error:', error);
        return server_1.NextResponse.json({ error: 'Failed to auto-map ingredients' }, { status: 500 });
    }
}
