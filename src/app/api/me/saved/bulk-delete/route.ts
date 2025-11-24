import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ensureSavedCollection } from "@/lib/collections";
import { prisma } from "@/lib/db";

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const recipeIds = Array.isArray(body?.recipeIds) ? body.recipeIds as string[] : null;

    if (!recipeIds || recipeIds.length === 0) {
      return NextResponse.json({ error: "Invalid recipe IDs" }, { status: 400 });
    }

    const savedCollectionId = await ensureSavedCollection(user.id);

    const deleteResult = await prisma.collectionRecipe.deleteMany({
      where: {
        collectionId: savedCollectionId,
        recipeId: { in: recipeIds }
      }
    });

    const savedCount = await prisma.collectionRecipe.count({
      where: { collectionId: savedCollectionId }
    });

    return NextResponse.json({
      success: true,
      removedCount: deleteResult.count,
      savedCount
    });
  } catch (error) {
    console.error("Error bulk unsaving recipes:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
