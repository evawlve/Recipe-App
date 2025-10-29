import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
import { ensureSavedCollection } from "@/lib/collections";

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
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
    const resolvedParams = await params;
    const user = await getCurrentUser();
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const recipeId = resolvedParams.id;
    
    // Ensure the recipe exists and get author info
    const recipe = await prisma.recipe.findUnique({
      where: { id: recipeId },
      select: { id: true, authorId: true, title: true }
    });
    
    if (!recipe) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }

    // Get or create the user's Saved collection
    const collectionId = await ensureSavedCollection(user.id);
    
    // Upsert the CollectionRecipe relationship
    await prisma.collectionRecipe.upsert({
      where: {
        collectionId_recipeId: {
          collectionId,
          recipeId
        }
      },
      update: {},
      create: {
        collectionId,
        recipeId
      }
    });

    // Create notification for recipe author if they're not the one saving
    if (recipe.authorId !== user.id) {
      await prisma.notification.create({
        data: {
          userId: recipe.authorId,
          actorId: user.id,
          type: 'save',
          recipeId: recipe.id
        }
      });
    }

    // Get the count of saved recipes for this user
    const count = await prisma.collectionRecipe.count({
      where: { collectionId }
    });

    return NextResponse.json({ saved: true, count });
  } catch (error) {
    console.error("Error saving recipe:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
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
    const resolvedParams = await params;
    const user = await getCurrentUser();
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const recipeId = resolvedParams.id;
    
    // Get the user's Saved collection
    const savedCollection = await prisma.collection.findUnique({
      where: {
        userId_name: {
          userId: user.id,
          name: "Saved"
        }
      }
    });

    if (!savedCollection) {
      // No saved collection exists, so nothing to delete
      return NextResponse.json({ saved: false, count: 0 });
    }

    // Delete the CollectionRecipe relationship (ignore if missing)
    await prisma.collectionRecipe.deleteMany({
      where: {
        collectionId: savedCollection.id,
        recipeId
      }
    });

    // Get the count of saved recipes for this user
    const count = await prisma.collectionRecipe.count({
      where: { collectionId: savedCollection.id }
    });

    return NextResponse.json({ saved: false, count });
  } catch (error) {
    console.error("Error unsaving recipe:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
