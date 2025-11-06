import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureSavedCollection } from "@/lib/collections";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const savedCollectionId = await ensureSavedCollection(user.id);
    
    const [saved, savedCount] = await Promise.all([
      prisma.recipe.findMany({
        where: { collections: { some: { collectionId: savedCollectionId } } },
        orderBy: { createdAt: "desc" },
        take: 24,
        select: { 
          id: true, 
          title: true, 
          createdAt: true, 
          author: { 
            select: { 
              id: true,
              name: true, 
              username: true, 
              displayName: true, 
              avatarKey: true 
            }
          }, 
          photos: { 
            select: { id: true, s3Key: true, width: true, height: true, isMainPhoto: true }, 
            take: 1,
            orderBy: [{ isMainPhoto: 'desc' }, { id: 'asc' }]
          } 
        }
      }),
      prisma.collectionRecipe.count({ where: { collectionId: savedCollectionId } })
    ]);

    return NextResponse.json({ saved, savedCount });
  } catch (error) {
    console.error("Error fetching saved recipes:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

