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
    avatarUrl: string | null;
    avatarKey: string | null;
  };
  uploaded: any[];
  saved: any[];
  uploadedCount: number;
  savedCount: number;
  tab: string;
}

export function MePageClient({ 
  user, 
  uploaded, 
  saved, 
  uploadedCount, 
  savedCount, 
  tab 
}: MePageClientProps) {
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState(user.avatarUrl);
  const [currentAvatarKey, setCurrentAvatarKey] = useState(user.avatarKey);

  const handleAvatarUpdate = (newAvatarUrl: string) => {
    console.log("MePageClient received avatar update:", newAvatarUrl);
    setCurrentAvatarUrl(newAvatarUrl);
  };

  return (
    <div className="container mx-auto max-w-6xl p-4 sm:p-6">
      <ProfileHeader 
        name={user.name} 
        email={user.email} 
        uploadedCount={uploadedCount} 
        savedCount={savedCount}
        avatarUrl={currentAvatarUrl}
        onAvatarUpdate={handleAvatarUpdate}
      />
      
      <TabNav tab={tab as "saved" | "uploaded" | "settings"} />
      
      <div className="mt-6">
        {tab === "saved" && <RecipeGrid items={saved} />}
        {tab === "uploaded" && <RecipeGrid items={uploaded} />}
        {tab === "settings" && (
          <SettingsPanel 
            name={user.name} 
            email={user.email}
            firstName={user.firstName}
            lastName={user.lastName}
            avatarUrl={currentAvatarUrl}
            avatarKey={currentAvatarKey}
            onAvatarUpdate={handleAvatarUpdate}
          />
        )}
      </div>
    </div>
  );
}
