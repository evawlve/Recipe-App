import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
export async function POST(_req: Request, { params }: any) {
	// Skip execution during build time
	if (process.env.NEXT_PHASE === 'phase-production-build' || 
	    process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
	    process.env.BUILD_TIME === 'true') {
		return NextResponse.json({ error: "Not available during build" }, { status: 503 });
	}

	// Import only when not in build mode
	const { prisma } = await import("@/lib/db");
	const { getCurrentUser } = await import("@/lib/auth");
	
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

export async function DELETE(_req: Request, { params }: any) {
	// Skip execution during build time
	if (process.env.NEXT_PHASE === 'phase-production-build' || 
	    process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
	    process.env.BUILD_TIME === 'true') {
		return NextResponse.json({ error: "Not available during build" }, { status: 503 });
	}

	// Import only when not in build mode
	const { prisma } = await import("@/lib/db");
	const { getCurrentUser } = await import("@/lib/auth");
	
const resolvedParams = await params;
	const user = await getCurrentUser();
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	await prisma.like.delete({ where: { userId_recipeId: { userId: user.id, recipeId: resolvedParams.id } } }).catch(() => null);
	const count = await prisma.like.count({ where: { recipeId: resolvedParams.id } });
	return NextResponse.json({ liked: false, count });
}


