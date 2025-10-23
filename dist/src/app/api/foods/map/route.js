"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
/**
 * Map an ingredient to a food
 * POST /api/foods/map
 * Body: { ingredientId: string, foodId: string, confidence?: number, useOnce?: boolean }
 */
async function POST(req) {
    try {
        const user = await (0, auth_1.getCurrentUser)();
        if (!user?.id) {
            return server_1.NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const { ingredientId, foodId, confidence = 0.5, useOnce = false } = await req.json();
        if (!ingredientId || !foodId) {
            return server_1.NextResponse.json({ error: 'Ingredient ID and Food ID are required' }, { status: 400 });
        }
        // Verify the ingredient belongs to a recipe owned by the user
        const ingredient = await db_1.prisma.ingredient.findFirst({
            where: {
                id: ingredientId,
                recipe: { authorId: user.id }
            }
        });
        if (!ingredient) {
            return server_1.NextResponse.json({ error: 'Ingredient not found' }, { status: 404 });
        }
        // Verify the food exists
        const food = await db_1.prisma.food.findUnique({
            where: { id: foodId }
        });
        if (!food) {
            return server_1.NextResponse.json({ error: 'Food not found' }, { status: 404 });
        }
        // Create the mapping (no upsert since we removed the unique constraint)
        const mapping = await db_1.prisma.ingredientFoodMap.create({
            data: {
                ingredientId,
                foodId,
                mappedBy: user.id,
                confidence,
                useOnce,
                isActive: true,
            }
        });
        return server_1.NextResponse.json({
            success: true,
            data: mapping
        });
    }
    catch (error) {
        console.error('Food mapping error:', error);
        return server_1.NextResponse.json({ error: 'Failed to map ingredient to food' }, { status: 500 });
    }
}
