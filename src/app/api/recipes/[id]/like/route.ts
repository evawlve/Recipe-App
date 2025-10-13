import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const resolvedParams = await params;
	const user = await getCurrentUser();
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	const recipe = await prisma.recipe.findUnique({ 
		where: { id: resolvedParams.id }, 
		select: { id: true, authorId: true, title: true } 
	});
	if (!recipe) return NextResponse.json({ error: "Recipe not found" }, { status: 404 });

	await prisma.like.create({ data: { userId: user.id, recipeId: recipe.id } }).catch(() => null);
	
	// Create notification for recipe author if they're not the one liking
	if (recipe.authorId !== user.id) {
		await prisma.notification.create({
			data: {
				userId: recipe.authorId,
				actorId: user.id,
				type: 'like',
				recipeId: recipe.id
			}
		});
	}
	
	const count = await prisma.like.count({ where: { recipeId: recipe.id } });
	return NextResponse.json({ liked: true, count });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const resolvedParams = await params;
	const user = await getCurrentUser();
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	await prisma.like.delete({ where: { userId_recipeId: { userId: user.id, recipeId: resolvedParams.id } } }).catch(() => null);
	const count = await prisma.like.count({ where: { recipeId: resolvedParams.id } });
	return NextResponse.json({ liked: false, count });
}


