"use client";

import { useState } from "react";
import ProfileHeader from "@/components/account/ProfileHeader";
import TabNav from "@/components/account/TabNav";
import RecipeGrid from "@/components/account/RecipeGrid";
import SettingsPanel from "@/components/account/SettingsPanel";

interface MePageClientProps {
  user: {
    id: string;
    name: string | null;
    email: string;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    bio: string | null;
    avatarUrl: string | null;
    avatarKey: string | null;
  };
  uploaded: any[];
  saved: any[];
  uploadedCount: number;
  savedCount: number;
  followersCount: number;
  followingCount: number;
  tab: string;
}

export function MePageClient({ 
  user, 
  uploaded, 
  saved, 
  uploadedCount, 
  savedCount, 
  followersCount,
  followingCount,
  tab 
}: MePageClientProps) {
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState(user.avatarUrl);
  const [currentAvatarKey, setCurrentAvatarKey] = useState(user.avatarKey);
  const [currentUser, setCurrentUser] = useState(user);

  const handleAvatarUpdate = (newAvatarUrl: string) => {
    console.log("MePageClient received avatar update:", newAvatarUrl);
    setCurrentAvatarUrl(newAvatarUrl);
  };

  const handleProfileUpdate = (updatedUser: Partial<typeof user>) => {
    console.log("MePageClient received profile update:", updatedUser);
    setCurrentUser(prev => ({ ...prev, ...updatedUser }));
  };

  return (
    <div className="container mx-auto max-w-6xl p-4 sm:p-6">
      <ProfileHeader 
        name={currentUser.name} 
        email={currentUser.email} 
        username={currentUser.username}
        bio={currentUser.bio}
        uploadedCount={uploadedCount} 
        savedCount={savedCount}
        followersCount={followersCount}
        followingCount={followingCount}
        avatarUrl={currentAvatarUrl}
        onAvatarUpdate={handleAvatarUpdate}
      />
      
      <TabNav tab={tab as "saved" | "uploaded" | "settings"} />
      
      <div className="mt-6">
        {tab === "saved" && <RecipeGrid items={saved} />}
        {tab === "uploaded" && <RecipeGrid items={uploaded} />}
        {tab === "settings" && (
          <SettingsPanel 
            name={currentUser.name} 
            email={currentUser.email}
            firstName={currentUser.firstName}
            lastName={currentUser.lastName}
            username={currentUser.username}
            bio={currentUser.bio}
            avatarUrl={currentAvatarUrl}
            avatarKey={currentAvatarKey}
            onAvatarUpdate={handleAvatarUpdate}
            onProfileUpdate={handleProfileUpdate}
          />
        )}
      </div>
    </div>
  );
}
