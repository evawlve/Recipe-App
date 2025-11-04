import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [uploaded, uploadedCount] = await Promise.all([
      prisma.recipe.findMany({
        where: { authorId: user.id },
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
          photos: { select: { id: true, s3Key: true, width: true, height: true }, take: 1 } 
        }
      }),
      prisma.recipe.count({ where: { authorId: user.id } })
    ]);

    return NextResponse.json({ uploaded, uploadedCount });
  } catch (error) {
    console.error("Error fetching uploaded recipes:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

