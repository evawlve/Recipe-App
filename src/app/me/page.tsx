import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ensureSavedCollection } from "@/lib/collections";
import { prisma } from "@/lib/db";
import ProfileHeader from "@/components/account/ProfileHeader";
import TabNav from "@/components/account/TabNav";
import RecipeGrid from "@/components/account/RecipeGrid";
import SettingsPanel from "@/components/account/SettingsPanel";
import { MePageClient } from "./MePageClient";

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
  const [uploaded, saved, uploadedCount, savedCount, followersCount, followingCount] = await Promise.all([
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
  ]);

  return (
    <MePageClient
      user={fullUser}
      uploaded={uploaded}
      saved={saved}
      uploadedCount={uploadedCount}
      savedCount={savedCount}
      followersCount={followersCount}
      followingCount={followingCount}
      tab={tab}
    />
  );
}
