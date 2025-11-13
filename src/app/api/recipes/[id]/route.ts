import { NextRequest, NextResponse } from "next/server";
// Sentry disabled - can be re-enabled in the future
// import * as Sentry from "@sentry/nextjs";
import { withSpan } from "@/lib/obs/withSpan";
import { capture } from "@/lib/obs/capture";
import { time } from "@/lib/perf";
import { shouldSkipCache, setCacheHeaders } from "@/lib/cache";

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	// Sentry disabled
	// Sentry.setTag('endpoint', 'recipes-id');
	try {
		const resolvedParams = await params;
		const recipeId = resolvedParams.id;
		
		// Check if we should skip caching
		const skipCache = shouldSkipCache(req);
		
		// Build cache key: global (not user-scoped), so just recipe ID
		const cacheKey = `recipe:${recipeId}`;
		
		const data = await time("api/recipes/[id]", async () =>
			withSpan('db.recipe.findUnique', async () => {
				const { prisma } = await import("@/lib/db");
				return prisma.recipe.findUnique({ where: { id: recipeId } });
			})
		);
		
		// Create response
		const response = data
			? NextResponse.json({ ok: true, recipe: data })
			: NextResponse.json({ ok: false }, { status: 404 });
		
		// Add cache headers if not skipped (global, not user-scoped)
		if (!skipCache) {
			// Sentry disabled
			// Sentry.addBreadcrumb({
			// 	category: 'cache',
			// 	message: 'Cache enabled for recipe',
			// 	level: 'info',
			// 	data: { cacheKey, 'cache.hit': false } // We can't determine HTTP cache hits from server
			// });
			setCacheHeaders(response, false); // isUserScoped = false (global)
		} else {
			// Sentry disabled
			// Sentry.addBreadcrumb({
			// 	category: 'cache',
			// 	message: 'Cache skipped for recipe',
			// 	level: 'info',
			// 	data: { cacheKey, 'cache.hit': false }
			// });
		}
		
		return response;
	} catch (error) {
		capture(error, { endpoint: 'recipes-id' });
		return NextResponse.json({ ok: false }, { status: 500 });
	}
}


export async function DELETE(
  _req: Request,
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
	const { S3Client, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
	
  const resolvedParams = await params;
  const id = resolvedParams.id;
  const user = await getCurrentUser();
  const region = process.env.AWS_REGION;
  const bucket = process.env.S3_BUCKET;
  if (!region || !bucket) {
    return NextResponse.json({ error: "Missing AWS_REGION or S3_BUCKET" }, { status: 500 });
  }

  const recipe = await prisma.recipe.findUnique({
    where: { id },
    include: { photos: true },
  });

  if (!recipe) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!user || recipe.authorId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Attempt S3 delete for all photo keys
  try {
    if (recipe.photos.length) {
      const s3 = new S3Client({ 
        region,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        }
      });
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: recipe.photos.map((p) => ({ Key: p.s3Key })),
            Quiet: true,
          },
        })
      );
    }
  } catch {
    // ignore S3 delete failures; continue DB cleanup
  }

  // DB cleanup (no cascades assumed)
  await prisma.$transaction([
    prisma.photo.deleteMany({ where: { recipeId: id } }),
    prisma.ingredient.deleteMany({ where: { recipeId: id } }),
    prisma.comment.deleteMany({ where: { recipeId: id } }),
    prisma.like.deleteMany({ where: { recipeId: id } }),
    prisma.recipeTag.deleteMany({ where: { recipeId: id } }),
    prisma.collectionRecipe.deleteMany({ where: { recipeId: id } }),
    prisma.nutrition.deleteMany({ where: { recipeId: id } }),
    prisma.recipe.delete({ where: { id } }),
  ]);

  return new NextResponse(null, { status: 204 });
}

export async function PATCH(
  req: Request,
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
	const { z } = await import("zod");
	const { recipeUpdateSchema } = await import("@/lib/validation");
	const { autoMapIngredients } = await import("@/lib/nutrition/auto-map");
	const { computeRecipeNutrition } = await import("@/lib/nutrition/compute");
	
  const resolvedParams = await params;
  const id = resolvedParams.id;
  
  // Get current user
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Load recipe and check ownership
  const recipe = await prisma.recipe.findUnique({
    where: { id },
    include: { ingredients: true, tags: true }
  });

  if (!recipe) {
    return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
  }

  if (recipe.authorId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Parse and validate request body
    const body = await req.json();
    const validatedData = recipeUpdateSchema.parse(body);

    // Update recipe fields
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (validatedData.title !== undefined) updateData.title = validatedData.title;
    if (validatedData.servings !== undefined) updateData.servings = validatedData.servings;
    if (validatedData.bodyMd !== undefined) updateData.bodyMd = validatedData.bodyMd;
    if (validatedData.prepTime !== undefined) updateData.prepTime = validatedData.prepTime;

    // Update recipe
    const updatedRecipe = await prisma.recipe.update({
      where: { id },
      data: updateData,
    });

    // Handle ingredients update if provided
    if (validatedData.ingredients !== undefined) {
      // Get existing ingredients to compare
      const existingIngredients = await prisma.ingredient.findMany({
        where: { recipeId: id },
        include: { foodMaps: true }
      });

      // Create a map of existing ingredients by unique key (name + qty + unit)
      const existingByKey = new Map(
        existingIngredients.map(ing => [`${ing.name}|${ing.qty}|${ing.unit}`, ing])
      );

      // Track which existing ingredients have been processed
      const processedExistingIds = new Set<string>();

      // Process each ingredient in the update
      for (const ingredient of validatedData.ingredients) {
        const key = `${ingredient.name}|${ingredient.qty}|${ingredient.unit}`;
        const existing = existingByKey.get(key);
        
        if (existing) {
          // This ingredient already exists with the same values, just mark as processed
          processedExistingIds.add(existing.id);
        } else {
          // Check if there's an existing ingredient with the same name but different qty/unit
          const existingWithSameName = existingIngredients.find(
            ing => ing.name === ingredient.name && !processedExistingIds.has(ing.id)
          );
          
          if (existingWithSameName) {
            // Update the existing ingredient
            await prisma.ingredient.update({
              where: { id: existingWithSameName.id },
              data: {
                qty: ingredient.qty,
                unit: ingredient.unit,
              }
            });
            processedExistingIds.add(existingWithSameName.id);
          } else {
            // Create new ingredient
            await prisma.ingredient.create({
              data: {
                recipeId: id,
                name: ingredient.name,
                qty: ingredient.qty,
                unit: ingredient.unit,
              }
            });
          }
        }
      }

      // Delete any remaining ingredients that weren't processed
      const ingredientsToDelete = existingIngredients.filter(
        ing => !processedExistingIds.has(ing.id)
      );
      
      if (ingredientsToDelete.length > 0) {
        await prisma.ingredient.deleteMany({
          where: {
            id: { in: ingredientsToDelete.map(ing => ing.id) }
          }
        });
      }
    }

    // Handle tags update if provided
    if (validatedData.tags !== undefined) {
      // Delete existing recipe tags
      await prisma.recipeTag.deleteMany({
        where: { recipeId: id }
      });

      // Upsert tags and create recipe tag links
      for (const tagLabel of validatedData.tags) {
        const slug = tagLabel.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const humanizedLabel = tagLabel.trim();
        
        // Check if a similar tag already exists in GOAL namespace
        // Try common variations to avoid duplicates (e.g., "preworkout" vs "pre-workout" vs "pre_workout")
        const slugVariations: string[] = [slug]; // Start with original slug
        
        // Generate variations for workout-related tags
        if (slug.includes('preworkout') || slug.includes('pre-workout') || slug.includes('pre_workout')) {
          slugVariations.push('pre-workout', 'pre_workout', 'preworkout');
        } else if (slug.includes('postworkout') || slug.includes('post-workout') || slug.includes('post_workout')) {
          slugVariations.push('post-workout', 'post_workout', 'postworkout');
        }
        
        // Add hyphen/underscore variations
        if (slug.includes('-')) {
          slugVariations.push(slug.replace(/-/g, '_'));
        }
        if (slug.includes('_')) {
          slugVariations.push(slug.replace(/_/g, '-'));
        }
        
        // Remove duplicates
        const uniqueVariations = [...new Set(slugVariations)];
        
        const existingTag = await prisma.tag.findFirst({
          where: {
            slug: { in: uniqueVariations },
            namespace: 'GOAL'
          }
        });
        
        // Use existing tag if found, otherwise create new one
        const tag = existingTag || await prisma.tag.upsert({
          where: { slug },
          update: {},
          create: { 
            slug,
            label: humanizedLabel,
            namespace: 'GOAL' // Use GOAL namespace to avoid polluting MEAL_TYPE selector
          },
        });

        await prisma.recipeTag.create({
          data: {
            recipeId: id,
            tagId: tag.id,
          }
        });
      }
    }

    // Handle photos update if provided
    if (validatedData.photos !== undefined && validatedData.photos.length > 0) {
      // Get the first existing photo to check if it's the main photo
      const existingMainPhoto = await prisma.photo.findFirst({
        where: { recipeId: id, isMainPhoto: true }
      });
      
      // If no main photo exists yet, mark the first new photo as main
      const shouldSetFirstAsMain = !existingMainPhoto;
      
      for (let i = 0; i < validatedData.photos.length; i++) {
        const photo = validatedData.photos[i];
        await prisma.photo.create({
          data: {
            recipeId: id,
            s3Key: photo.s3Key,
            width: photo.width,
            height: photo.height,
            isMainPhoto: shouldSetFirstAsMain && i === 0,
          }
        });
      }
    }

    // Auto-map any new ingredients to foods and compute nutrition
    // Only run auto-mapping if ingredients were actually changed
    if (validatedData.ingredients !== undefined) {
      try {
        const mappedCount = await autoMapIngredients(id);
        console.log(`Auto-mapped ${mappedCount} ingredients for recipe ${id}`);
        
        // Always compute nutrition after ingredient changes
        await computeRecipeNutrition(id, 'general');
        console.log(`Computed nutrition for recipe ${id}`);
      } catch (error) {
        console.error('Error auto-mapping ingredients or computing nutrition:', error);
        // Don't fail the recipe update if auto-mapping fails
      }
    } else {
      // If no ingredients changed, just compute nutrition for existing mappings
      try {
        await computeRecipeNutrition(id, 'general');
        console.log(`Computed nutrition for recipe ${id}`);
      } catch (error) {
        console.error('Error computing nutrition:', error);
      }
    }

    return NextResponse.json({ 
      success: true, 
      recipe: { id: updatedRecipe.id } 
    });

  } catch (error) {
    console.error("Error updating recipe:", error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json({ 
        error: "Validation error", 
        details: error.errors 
      }, { status: 400 });
    }

    return NextResponse.json({ 
      error: "Failed to update recipe" 
    }, { status: 500 });
  }
}
