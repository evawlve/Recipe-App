import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { recipeUpdateSchema } from "@/lib/validation";
import { z } from "zod";
import { autoMapIngredients } from "@/lib/nutrition/auto-map";
import { computeRecipeNutrition } from "@/lib/nutrition/compute";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
        
        const tag = await prisma.tag.upsert({
          where: { slug },
          update: {},
          create: { 
            slug,
            label: humanizedLabel 
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
