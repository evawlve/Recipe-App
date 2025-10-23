"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
async function POST(_req, { params }) {
    const resolvedParams = await params;
    const user = await (0, auth_1.getCurrentUser)();
    if (!user)
        return server_1.NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const recipe = await db_1.prisma.recipe.findUnique({
        where: { id: resolvedParams.id },
        select: { id: true, authorId: true, title: true }
    });
    if (!recipe)
        return server_1.NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    await db_1.prisma.like.create({ data: { userId: user.id, recipeId: recipe.id } }).catch(() => null);
    // Create notification for recipe author if they're not the one liking
    if (recipe.authorId !== user.id) {
        await db_1.prisma.notification.create({
            data: {
                userId: recipe.authorId,
                actorId: user.id,
                type: 'like',
                recipeId: recipe.id
            }
        });
    }
    const count = await db_1.prisma.like.count({ where: { recipeId: recipe.id } });
    return server_1.NextResponse.json({ liked: true, count });
}
async function DELETE(_req, { params }) {
    const resolvedParams = await params;
    const user = await (0, auth_1.getCurrentUser)();
    if (!user)
        return server_1.NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await db_1.prisma.like.delete({ where: { userId_recipeId: { userId: user.id, recipeId: resolvedParams.id } } }).catch(() => null);
    const count = await db_1.prisma.like.count({ where: { recipeId: resolvedParams.id } });
    return server_1.NextResponse.json({ liked: false, count });
}
