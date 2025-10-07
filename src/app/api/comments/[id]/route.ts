import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { commentBodySchema } from "@/lib/validation/comment";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const resolvedParams = await params;
	const user = await getCurrentUser();
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const c = await prisma.comment.findUnique({
		where: { id: resolvedParams.id },
		include: { recipe: { select: { authorId: true } } },
	});
	if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

	const canDelete = c.userId === user.id || c.recipe.authorId === user.id;
	if (!canDelete) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

	await prisma.comment.delete({ where: { id: resolvedParams.id } });
	return new Response(null, { status: 204 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const resolvedParams = await params;
	const user = await getCurrentUser();
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const existing = await prisma.comment.findUnique({ where: { id: resolvedParams.id }, select: { userId: true } });
	if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
	if (existing.userId !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

	const json = await req.json().catch(() => ({}));
	const parsed = commentBodySchema.safeParse(json);
	if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

	const updated = await prisma.comment.update({
		where: { id: resolvedParams.id },
		data: { body: parsed.data.body },
		select: { id: true, body: true, createdAt: true, user: { select: { id: true, name: true } } },
	});
	return NextResponse.json(updated);
}


