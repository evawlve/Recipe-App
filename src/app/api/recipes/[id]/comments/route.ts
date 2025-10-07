import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { commentBodySchema } from "@/lib/validation/comment";
import { nanoid } from "nanoid";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const resolvedParams = await params;
	const user = await getCurrentUser();
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const recipe = await prisma.recipe.findUnique({ where: { id: resolvedParams.id }, select: { id: true } });
	if (!recipe) return NextResponse.json({ error: "Recipe not found" }, { status: 404 });

	const json = await req.json().catch(() => ({}));
	const parsed = commentBodySchema.safeParse(json);
	if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

	const c = await prisma.comment.create({
		data: { id: nanoid(), recipeId: recipe.id, userId: user.id, body: parsed.data.body },
		select: { id: true, body: true, createdAt: true, user: { select: { id: true, name: true } } },
	});
	return NextResponse.json(c, { status: 201 });
}


