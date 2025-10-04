import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { recipeIds } = body;

    if (!Array.isArray(recipeIds) || recipeIds.length === 0) {
      return NextResponse.json({ error: "Invalid recipe IDs" }, { status: 400 });
    }

    const user = await getCurrentUser();
    const region = process.env.AWS_REGION;
    const bucket = process.env.S3_BUCKET;
    
    if (!region || !bucket) {
      return NextResponse.json({ error: "Missing AWS_REGION or S3_BUCKET" }, { status: 500 });
    }

    // Get all recipes that belong to the current user
    const recipes = await prisma.recipe.findMany({
      where: {
        id: { in: recipeIds },
        authorId: user.id, // Only allow deleting own recipes
      },
      include: { photos: true },
    });

    if (recipes.length === 0) {
      return NextResponse.json({ error: "No recipes found or not authorized" }, { status: 404 });
    }

    // Collect all S3 keys for deletion
    const allS3Keys = recipes.flatMap(recipe => 
      recipe.photos.map(photo => photo.s3Key)
    );

    // Delete S3 objects
    try {
      if (allS3Keys.length > 0) {
        const s3 = new S3Client({ region });
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: allS3Keys.map(key => ({ Key: key })),
              Quiet: true,
            },
          })
        );
      }
    } catch (error) {
      console.error("S3 delete error:", error);
      // Continue with DB cleanup even if S3 delete fails
    }

    // Delete all related data in transactions
    const recipeIdsToDelete = recipes.map(r => r.id);
    
    await prisma.$transaction([
      // Delete all related data first
      prisma.photo.deleteMany({ where: { recipeId: { in: recipeIdsToDelete } } }),
      prisma.ingredient.deleteMany({ where: { recipeId: { in: recipeIdsToDelete } } }),
      prisma.comment.deleteMany({ where: { recipeId: { in: recipeIdsToDelete } } }),
      prisma.like.deleteMany({ where: { recipeId: { in: recipeIdsToDelete } } }),
      prisma.recipeTag.deleteMany({ where: { recipeId: { in: recipeIdsToDelete } } }),
      prisma.collectionRecipe.deleteMany({ where: { recipeId: { in: recipeIdsToDelete } } }),
      prisma.nutrition.deleteMany({ where: { recipeId: { in: recipeIdsToDelete } } }),
      // Finally delete the recipes
      prisma.recipe.deleteMany({ where: { id: { in: recipeIdsToDelete } } }),
    ]);

    return NextResponse.json({ 
      success: true, 
      deletedCount: recipes.length 
    });

  } catch (error) {
    console.error("Bulk delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete recipes" },
      { status: 500 }
    );
  }
}
