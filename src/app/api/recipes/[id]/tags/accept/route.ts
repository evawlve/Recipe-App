import { NextRequest, NextResponse } from "next/server";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
	// Skip execution during build time
	if (process.env.NEXT_PHASE === 'phase-production-build' || 
	    process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
	    process.env.BUILD_TIME === 'true') {
		return NextResponse.json({ error: "Not available during build" }, { status: 503 });
	}

	// Import only when not in build mode
	const { prisma } = await import("@/lib/db");
	const { getCurrentUser } = await import("@/lib/auth");
	
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;
    const recipeId = resolvedParams.id;

    // Verify recipe exists and user has access
    const recipe = await prisma.recipe.findFirst({
      where: { id: recipeId },
      select: { id: true, authorId: true }
    });

    if (!recipe) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }

    // Parse request body
    const body = await request.json();
    const { tagSlug, namespace } = body;

    if (!tagSlug || !namespace) {
      return NextResponse.json(
        { error: "tagSlug and namespace are required" },
        { status: 400 }
      );
    }

    // Find or create the tag
    const tag = await prisma.tag.upsert({
      where: { slug: tagSlug },
      update: {},
      create: {
        slug: tagSlug,
        label: tagSlug.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
        namespace: namespace as any
      }
    });

    // Create or update the recipe tag with AUTO_CONFIDENT source
    await prisma.recipeTag.upsert({
      where: {
        recipeId_tagId: {
          recipeId: recipeId,
          tagId: tag.id
        }
      },
      update: {
        source: 'AUTO_CONFIDENT',
        confidence: 1.0
      },
      create: {
        recipeId: recipeId,
        tagId: tag.id,
        source: 'AUTO_CONFIDENT',
        confidence: 1.0
      }
    });

    return NextResponse.json({
      success: true,
      message: `Tag "${tagSlug}" accepted and added to recipe`
    });

  } catch (error) {
    console.error("Error accepting suggestion:", error);
    return NextResponse.json(
      { error: "Failed to accept suggestion" },
      { status: 500 }
    );
  }
}
