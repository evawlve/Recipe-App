import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ensureSavedCollection } from "@/lib/collections";
import { prisma } from "@/lib/db";
import ProfileHeader from "@/components/account/ProfileHeader";
import TabNav from "@/components/account/TabNav";
import RecipeGrid from "@/components/account/RecipeGrid";
import SettingsPanel from "@/components/account/SettingsPanel";
import { MePageClient } from "./MePageClient";

// Force dynamic rendering for pages that use authentication
export const dynamic = 'force-dynamic';

interface MePageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function MePage({ searchParams }: MePageProps) {
  const user = await getCurrentUser();
  
  if (!user) {
    redirect("/signin");
  }

  // Fetch the complete user data with new fields
  const fullUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      name: true,
      email: true,
      firstName: true,
      lastName: true,
      username: true,
      bio: true,
      avatarUrl: true,
      avatarKey: true,
    }
  });

  if (!fullUser) {
    redirect("/signin");
  }

  const { tab = "saved" } = await searchParams;
  
  // Ensure we have a "Saved" collection for this user
  const savedCollectionId = await ensureSavedCollection(user.id);
  
  // Fetch data in parallel
  const [uploaded, saved, uploadedCount, savedCount, followersCount, followingCount, followers, following] = await Promise.all([
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
        photos: { select: { id: true, s3Key: true, width: true, height: true }, take: 1 } 
      }
    }),
    prisma.recipe.count({ where: { authorId: user.id } }),
    prisma.collectionRecipe.count({ where: { collectionId: savedCollectionId } }),
    prisma.follow.count({ where: { followingId: user.id } }),
    prisma.follow.count({ where: { followerId: user.id } }),
    // Fetch followers with their follow status
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
    }),
    // Fetch following users
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

  // Transform following data
  const followingUsers = following.map(follow => follow.following);

  return (
    <MePageClient
      user={fullUser}
      uploaded={uploaded}
      saved={saved}
      uploadedCount={uploadedCount}
      savedCount={savedCount}
      followersCount={followersCount}
      followingCount={followingCount}
      followers={followersWithStatus}
      following={followingUsers}
      tab={tab}
    />
  );
}
