"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const zod_1 = require("zod");
const Body = zod_1.z.object({
    label: zod_1.z.string().min(1),
    grams: zod_1.z.number().positive(),
});
async function POST(req, { params }) {
    try {
        const user = await (0, auth_1.getCurrentUser)();
        if (!user?.id) {
            return server_1.NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const parse = Body.safeParse(await req.json());
        if (!parse.success) {
            return server_1.NextResponse.json({
                success: false,
                error: parse.error.flatten()
            }, { status: 400 });
        }
        const { label, grams } = parse.data;
        const { id } = await params;
        // Verify the food exists
        const food = await db_1.prisma.food.findUnique({
            where: { id }
        });
        if (!food) {
            return server_1.NextResponse.json({ error: 'Food not found' }, { status: 404 });
        }
        // Create the FoodUnit
        const foodUnit = await db_1.prisma.foodUnit.create({
            data: {
                foodId: id,
                label,
                grams,
            }
        });
        return server_1.NextResponse.json({ success: true, data: foodUnit }, { status: 201 });
    }
    catch (error) {
        console.error('FoodUnit creation error:', error);
        return server_1.NextResponse.json({ success: false, error: 'Failed to create food unit' }, { status: 500 });
    }
}
