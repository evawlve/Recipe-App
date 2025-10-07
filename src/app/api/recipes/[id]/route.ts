import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { recipeUpdateSchema } from "@/lib/validation";
import { z } from "zod";

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
      const s3 = new S3Client({ region });
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
      // Delete existing ingredients
      await prisma.ingredient.deleteMany({
        where: { recipeId: id }
      });

      // Create new ingredients
      await prisma.ingredient.createMany({
        data: validatedData.ingredients.map(ingredient => ({
          recipeId: id,
          name: ingredient.name,
          qty: ingredient.qty,
          unit: ingredient.unit,
        }))
      });
    }

    // Handle tags update if provided
    if (validatedData.tags !== undefined) {
      // Delete existing recipe tags
      await prisma.recipeTag.deleteMany({
        where: { recipeId: id }
      });

      // Upsert tags and create recipe tag links
      for (const tagLabel of validatedData.tags) {
        const tag = await prisma.tag.upsert({
          where: { slug: tagLabel.toLowerCase().replace(/\s+/g, '-') },
          update: {},
          create: { 
            slug: tagLabel.toLowerCase().replace(/\s+/g, '-'),
            label: tagLabel 
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
