"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const comment_1 = require("@/lib/validation/comment");
const nanoid_1 = require("nanoid");
async function POST(req, { params }) {
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
    const json = await req.json().catch(() => ({}));
    const parsed = comment_1.commentBodySchema.safeParse(json);
    if (!parsed.success)
        return server_1.NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const c = await db_1.prisma.comment.create({
        data: { id: (0, nanoid_1.nanoid)(), recipeId: recipe.id, userId: user.id, body: parsed.data.body },
        select: { id: true, body: true, createdAt: true, user: { select: { id: true, name: true } } },
    });
    // Create notification for recipe author if they're not the one commenting
    if (recipe.authorId !== user.id) {
        await db_1.prisma.notification.create({
            data: {
                userId: recipe.authorId,
                actorId: user.id,
                type: 'comment',
                recipeId: recipe.id,
                commentId: c.id
            }
        });
    }
    return server_1.NextResponse.json(c, { status: 201 });
}
