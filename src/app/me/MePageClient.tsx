"use client";

import { useState, useEffect } from "react";
import ProfileHeader from "@/components/account/ProfileHeader";
import TabNav from "@/components/account/TabNav";
import RecipeGrid from "@/components/account/RecipeGrid";
import SettingsPanel from "@/components/account/SettingsPanel";
import FollowersList from "@/components/account/FollowersList";
import FollowingList from "@/components/account/FollowingList";

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
}

type TabType = "saved" | "uploaded" | "followers" | "following" | "settings";

interface TabData {
  uploaded?: any[];
  uploadedCount?: number;
  saved?: any[];
  savedCount?: number;
  followers?: any[];
  followersCount?: number;
  following?: any[];
  followingCount?: number;
}

export function MePageClient({ user }: MePageClientProps) {
  const [currentTab, setCurrentTab] = useState<TabType>("saved");
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState(user.avatarUrl);
  const [currentAvatarKey, setCurrentAvatarKey] = useState(user.avatarKey);
  const [currentUser, setCurrentUser] = useState(user);
  
  // Track what data has been loaded
  const [tabData, setTabData] = useState<TabData>({});
  const [loadingTabs, setLoadingTabs] = useState<Set<TabType>>(new Set());
  const [loadedTabs, setLoadedTabs] = useState<Set<TabType>>(new Set());

  const handleAvatarUpdate = (newAvatarUrl: string) => {
    setCurrentAvatarUrl(newAvatarUrl);
  };

  const handleProfileUpdate = (updatedUser: Partial<typeof user>) => {
    setCurrentUser(prev => ({ ...prev, ...updatedUser }));
  };

  const handleTabChange = (newTab: TabType) => {
    setCurrentTab(newTab);
  };

  // Lazy load tab data when tab changes
  useEffect(() => {
    const loadTabData = async () => {
      // Skip if already loaded or loading or settings tab (no data needed)
      if (loadedTabs.has(currentTab) || loadingTabs.has(currentTab) || currentTab === "settings") {
        return;
      }

      setLoadingTabs(prev => new Set(prev).add(currentTab));

      try {
        let endpoint = "";
        switch (currentTab) {
          case "saved":
            endpoint = "/api/me/saved";
            break;
          case "uploaded":
            endpoint = "/api/me/uploaded";
            break;
          case "followers":
            endpoint = "/api/me/followers";
            break;
          case "following":
            endpoint = "/api/me/following";
            break;
        }

        const response = await fetch(endpoint);
        if (!response.ok) throw new Error("Failed to fetch data");
        
        const data = await response.json();
        
        setTabData(prev => ({ ...prev, ...data }));
        setLoadedTabs(prev => new Set(prev).add(currentTab));
      } catch (error) {
        console.error(`Error loading ${currentTab} data:`, error);
      } finally {
        setLoadingTabs(prev => {
          const next = new Set(prev);
          next.delete(currentTab);
          return next;
        });
      }
    };

    loadTabData();
  }, [currentTab, loadedTabs, loadingTabs]);

  const isLoading = loadingTabs.has(currentTab);
  const uploadedCount = tabData.uploadedCount ?? 0;
  const savedCount = tabData.savedCount ?? 0;
  const followersCount = tabData.followersCount ?? 0;
  const followingCount = tabData.followingCount ?? 0;

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
        onTabChange={handleTabChange}
      />
      
      <TabNav tab={currentTab} onTabChange={handleTabChange} />
      
      <div className="mt-6">
        {currentTab === "saved" && (
          isLoading ? (
            <RecipeGridSkeleton />
          ) : (
            <RecipeGrid items={tabData.saved ?? []} currentUserId={user.id} />
          )
        )}
        {currentTab === "uploaded" && (
          isLoading ? (
            <RecipeGridSkeleton />
          ) : (
            <RecipeGrid items={tabData.uploaded ?? []} currentUserId={user.id} />
          )
        )}
        {currentTab === "followers" && (
          isLoading ? (
            <FollowersListSkeleton />
          ) : (
            <FollowersList followers={tabData.followers ?? []} currentUserId={user.id} />
          )
        )}
        {currentTab === "following" && (
          isLoading ? (
            <FollowersListSkeleton />
          ) : (
            <FollowingList following={tabData.following ?? []} currentUserId={user.id} />
          )
        )}
        {currentTab === "settings" && (
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

// Skeleton loading components
function RecipeGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="bg-muted rounded-lg aspect-square mb-2"></div>
          <div className="h-4 bg-muted rounded w-3/4"></div>
        </div>
      ))}
    </div>
  );
}

function FollowersListSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="animate-pulse flex items-center gap-4">
          <div className="h-12 w-12 bg-muted rounded-full"></div>
          <div className="flex-1">
            <div className="h-4 bg-muted rounded w-1/3 mb-2"></div>
            <div className="h-3 bg-muted rounded w-1/2"></div>
          </div>
          <div className="h-9 w-20 bg-muted rounded"></div>
        </div>
      ))}
    </div>
  );
}
