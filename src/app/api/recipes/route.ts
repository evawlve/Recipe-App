import { NextResponse } from "next/server";
import { time } from "@/lib/perf";

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
// Avoid top-level heavy imports; dynamically import inside handlers


export async function GET(_req: Request) {
	const data = await time("api/recipes", async () => {
		const { prisma } = await import("@/lib/db");
		return prisma.recipe.findMany({ take: 24, orderBy: { createdAt: "desc" } });
	});
	return NextResponse.json({ ok: true, recipes: data });
}

export async function POST(request: Request) {
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
    const body = await request.json();
    
    // Debug logging
    console.log('Received photos in API:', body.photos);
    console.log('Number of photos received:', body.photos?.length || 0);
    
    // Validate the request body
    const { recipeApiSchema } = await import("@/lib/validation");
    const validatedData = recipeApiSchema.parse(body);
    
    // Get the authenticated user
    const { getCurrentUser } = await import("@/lib/auth");
    const author = await getCurrentUser();
    
    if (!author) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }
    
    // Create the recipe with ingredients, photos, and tags
    const { prisma } = await import("@/lib/db");
    const recipe = await prisma.recipe.create({
      data: {
        title: validatedData.title,
        servings: validatedData.servings,
        bodyMd: validatedData.bodyMd,
        prepTime: validatedData.prepTime,
        authorId: author.id,
        ingredients: {
          create: validatedData.ingredients.map(ingredient => ({
            name: ingredient.name,
            qty: ingredient.qty,
            unit: ingredient.unit,
          })),
        },
        photos: {
          create: validatedData.photos.map(photo => ({
            s3Key: photo.s3Key,
            width: photo.width,
            height: photo.height,
          })),
        },
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            username: true,
            displayName: true,
            avatarKey: true,
          },
        },
      },
    });

    // Handle tags if provided
    if (validatedData.tags && validatedData.tags.length > 0) {
      for (const tagLabel of validatedData.tags) {
        const slug = tagLabel.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const humanizedLabel = tagLabel.trim();
        
        // Upsert tag
        const tag = await prisma.tag.upsert({
          where: { slug },
          update: {},
          create: { 
            slug,
            label: humanizedLabel,
            namespace: 'MEAL_TYPE' // Default namespace for legacy tags
          },
        });

        // Create recipe tag link
        await prisma.recipeTag.create({
          data: {
            recipeId: recipe.id,
            tagId: tag.id,
          }
        });
      }
    }

    // Handle new tag classification fields
    const tagClassificationFields = [
      { field: 'mealType', namespace: 'MEAL_TYPE' },
      { field: 'cuisine', namespace: 'CUISINE' },
      { field: 'method', namespace: 'METHOD' },
      { field: 'diet', namespace: 'DIET' }
    ];

    for (const { field, namespace } of tagClassificationFields) {
      const tagIds = validatedData[field as keyof typeof validatedData] as string[];
      
      if (tagIds && tagIds.length > 0) {
        for (const tagId of tagIds) {
          // Create recipe tag link with source=USER and confidence=1.0
          await prisma.recipeTag.create({
            data: {
              recipeId: recipe.id,
              tagId: tagId,
              source: 'USER',
              confidence: 1.0
            }
          });
        }
      }
    }

    // Auto-map ingredients to foods and compute nutrition
    try {
      const { autoMapIngredients } = await import("@/lib/nutrition/auto-map");
      const mappedCount = await autoMapIngredients(recipe.id);
      console.log(`Auto-mapped ${mappedCount} ingredients for recipe ${recipe.id}`);
      
      // Compute nutrition after mapping ingredients
      const { computeRecipeNutrition } = await import("@/lib/nutrition/compute");
      await computeRecipeNutrition(recipe.id, 'general');
      console.log(`Computed nutrition for recipe ${recipe.id}`);
      
      // Write recipe features after nutrition is computed
      const { writeRecipeFeatureLite } = await import("@/lib/features/writeRecipeFeatureLite");
      await writeRecipeFeatureLite(recipe.id);
      console.log(`Computed features for recipe ${recipe.id}`);
    } catch (error) {
      console.error('Error auto-mapping ingredients, computing nutrition, or writing features:', error);
      // Don't fail the recipe creation if auto-mapping fails
    }
    
    return NextResponse.json({ 
      success: true, 
      recipe: { id: recipe.id } 
    });
  } catch (error) {
    console.error("Error creating recipe:", error);
    
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json(
        { success: false, error: "Invalid form data" },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { success: false, error: "Failed to create recipe" },
      { status: 500 }
    );
  }
}
