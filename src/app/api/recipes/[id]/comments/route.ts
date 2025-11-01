import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
import { nanoid } from "nanoid";


export async function POST(req: Request, { params }: any) {
	// Skip execution during build time
	if (process.env.NEXT_PHASE === 'phase-production-build' || 
	    process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
	    process.env.BUILD_TIME === 'true') {
		return NextResponse.json({ error: "Not available during build" }, { status: 503 });
	}

	// Import only when not in build mode
	const { prisma } = await import("@/lib/db");
	const { getCurrentUser } = await import("@/lib/auth");
	const { commentBodySchema } = await import("@/lib/validation/comment");
	
    const resolvedParams = await params;
	const user = await getCurrentUser();
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const recipe = await prisma.recipe.findUnique({ 
		where: { id: resolvedParams.id }, 
		select: { id: true, authorId: true, title: true } 
	});
	if (!recipe) return NextResponse.json({ error: "Recipe not found" }, { status: 404 });

	const json = await req.json().catch(() => ({}));
	const parsed = commentBodySchema.safeParse(json);
	if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

	const c = await prisma.comment.create({
		data: { id: nanoid(), recipeId: recipe.id, userId: user.id, body: parsed.data.body },
		select: { id: true, body: true, createdAt: true, user: { select: { id: true, name: true } } },
	});

	// Create notification for recipe author if they're not the one commenting
	if (recipe.authorId !== user.id) {
		const { notifyComment } = await import('@/lib/notifications/create');
		await notifyComment({
			userId: recipe.authorId,
			actorId: user.id,
			recipeId: recipe.id,
			commentId: c.id,
		});
	}

	return NextResponse.json(c, { status: 201 });
}


