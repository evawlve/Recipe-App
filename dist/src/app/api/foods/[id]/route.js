"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const servings_1 = require("@/lib/units/servings");
async function GET(_req, { params }) {
    try {
        const { id } = await params;
        if (!id) {
            return server_1.NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
        }
        const f = await db_1.prisma.food.findUnique({
            where: { id },
            include: { units: true }
        });
        if (!f) {
            return server_1.NextResponse.json({ success: false, error: 'Food not found' }, { status: 404 });
        }
        const servingOptions = (0, servings_1.deriveServingOptions)({
            units: f.units?.map(u => ({ label: u.label, grams: u.grams })),
            densityGml: f.densityGml ?? undefined,
            categoryId: f.categoryId ?? null,
        });
        return server_1.NextResponse.json({
            success: true,
            data: {
                id: f.id,
                name: f.name,
                brand: f.brand,
                categoryId: f.categoryId,
                source: f.source,
                verification: f.verification,
                densityGml: f.densityGml,
                kcal100: f.kcal100,
                protein100: f.protein100,
                carbs100: f.carbs100,
                fat100: f.fat100,
                fiber100: f.fiber100,
                sugar100: f.sugar100,
                popularity: f.popularity,
                servingOptions,
            }
        });
    }
    catch (error) {
        console.error('Food by id error:', error);
        return server_1.NextResponse.json({ success: false, error: 'Failed to load food' }, { status: 500 });
    }
}
