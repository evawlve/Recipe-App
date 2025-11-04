import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [followingCount, following] = await Promise.all([
      prisma.follow.count({ where: { followerId: user.id } }),
      prisma.follow.findMany({
        where: { followerId: user.id },
        include: {
          following: {
            select: {
              id: true,
              name: true,
              username: true,
              displayName: true,
              avatarUrl: true,
              avatarKey: true,
              bio: true
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: 50
      })
    ]);

    // Transform following data
    const followingUsers = following.map(follow => follow.following);

    return NextResponse.json({ followingCount, following: followingUsers });
  } catch (error) {
    console.error("Error fetching following:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

