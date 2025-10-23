"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const zod_1 = require("zod");
const db_1 = require("@/lib/db");
const Body = zod_1.z.object({
    name: zod_1.z.string().min(2),
    brand: zod_1.z.string().trim().optional(),
    categoryId: zod_1.z.string().optional(),
    servingLabel: zod_1.z.string().min(1),
    gramsPerServing: zod_1.z.number().positive().optional(),
    kcal: zod_1.z.number().min(0).max(1200),
    protein: zod_1.z.number().min(0).max(120),
    carbs: zod_1.z.number().min(0).max(200),
    fat: zod_1.z.number().min(0).max(120),
    fiber: zod_1.z.number().min(0).max(60).optional(),
    sugar: zod_1.z.number().min(0).max(150).optional(),
    densityGml: zod_1.z.number().positive().optional(),
});
async function POST(req) {
    try {
        const parse = Body.safeParse(await req.json());
        if (!parse.success) {
            return server_1.NextResponse.json({
                success: false,
                error: parse.error.flatten()
            }, { status: 400 });
        }
        const b = parse.data;
        const grams = b.gramsPerServing ??
            (b.servingLabel.match(/(\d+(\.\d+)?)\s*g$/i) ? parseFloat(RegExp.$1) : NaN);
        if (!grams || !isFinite(grams)) {
            return server_1.NextResponse.json({
                success: false,
                error: 'gramsPerServing required or inferable from servingLabel (e.g., "100 g")'
            }, { status: 400 });
        }
        // derive per-100g
        const to100 = (x) => (x ?? 0) / grams * 100;
        const kcal100 = to100(b.kcal);
        if (kcal100 < 0 || kcal100 > 1200) {
            return server_1.NextResponse.json({
                success: false,
                error: 'implausible kcal/100g'
            }, { status: 422 });
        }
        const userId = req.headers.get('x-user-id') || null;
        const food = await db_1.prisma.food.create({
            data: {
                name: b.name,
                brand: b.brand ?? null,
                categoryId: b.categoryId ?? null,
                source: 'community',
                verification: 'unverified',
                densityGml: b.densityGml ?? null,
                kcal100,
                protein100: to100(b.protein),
                carbs100: to100(b.carbs),
                fat100: to100(b.fat),
                fiber100: b.fiber != null ? to100(b.fiber) : null,
                sugar100: b.sugar != null ? to100(b.sugar) : null,
                createdById: userId,
                popularity: 0,
                units: { create: [{ label: b.servingLabel, grams }] },
            },
            select: { id: true },
        });
        return server_1.NextResponse.json({ success: true, foodId: food.id }, { status: 201 });
    }
    catch (error) {
        console.error('Quick create error:', error);
        return server_1.NextResponse.json({ success: false, error: 'Failed to create food' }, { status: 500 });
    }
}
