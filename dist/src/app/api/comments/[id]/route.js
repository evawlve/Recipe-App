"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DELETE = DELETE;
exports.PATCH = PATCH;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const comment_1 = require("@/lib/validation/comment");
async function DELETE(_req, { params }) {
    const resolvedParams = await params;
    const user = await (0, auth_1.getCurrentUser)();
    if (!user)
        return server_1.NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const c = await db_1.prisma.comment.findUnique({
        where: { id: resolvedParams.id },
        include: { recipe: { select: { authorId: true } } },
    });
    if (!c)
        return server_1.NextResponse.json({ error: "Not found" }, { status: 404 });
    const canDelete = c.userId === user.id || c.recipe.authorId === user.id;
    if (!canDelete)
        return server_1.NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await db_1.prisma.comment.delete({ where: { id: resolvedParams.id } });
    return new Response(null, { status: 204 });
}
async function PATCH(req, { params }) {
    const resolvedParams = await params;
    const user = await (0, auth_1.getCurrentUser)();
    if (!user)
        return server_1.NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const existing = await db_1.prisma.comment.findUnique({ where: { id: resolvedParams.id }, select: { userId: true } });
    if (!existing)
        return server_1.NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.userId !== user.id)
        return server_1.NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const json = await req.json().catch(() => ({}));
    const parsed = comment_1.commentBodySchema.safeParse(json);
    if (!parsed.success)
        return server_1.NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const updated = await db_1.prisma.comment.update({
        where: { id: resolvedParams.id },
        data: { body: parsed.data.body },
        select: { id: true, body: true, createdAt: true, user: { select: { id: true, name: true } } },
    });
    return server_1.NextResponse.json(updated);
}
