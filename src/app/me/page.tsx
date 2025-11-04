import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MePageClient } from "./MePageClient";

// Force dynamic rendering for pages that use authentication
export const dynamic = 'force-dynamic';

export default async function MePage() {
  const user = await getCurrentUser();
  
  if (!user) {
    redirect("/signin");
  }

  // Only fetch the basic user profile data - everything else will be loaded on-demand
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

  return <MePageClient user={fullUser} />;
}
