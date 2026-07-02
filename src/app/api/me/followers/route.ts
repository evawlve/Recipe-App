import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [followersCount, followers] = await Promise.all([
      prisma.follow.count({ where: { followingId: user.id } }),
      prisma.follow.findMany({
        where: { followingId: user.id },
        include: {
          follower: {
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

    // Get the IDs of followers that the current user follows
    const followerIds = followers.map(f => f.follower.id);
    const currentUserFollowing = followerIds.length > 0 ? await prisma.follow.findMany({
      where: {
        followerId: user.id,
        followingId: { in: followerIds }
      },
      select: { followingId: true }
    }) : [];
    
    const followingSet = new Set(currentUserFollowing.map(f => f.followingId));

    // Transform followers data to include follow status
    const followersWithStatus = followers.map(follow => ({
      ...follow.follower,
      isFollowing: followingSet.has(follow.follower.id)
    }));

    return NextResponse.json({ followersCount, followers: followersWithStatus });
  } catch (error) {
    console.error("Error fetching followers:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

