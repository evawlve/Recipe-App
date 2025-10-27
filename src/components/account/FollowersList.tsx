"use client";

import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { UserPlus, UserMinus } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Follower {
  id: string;
  name: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  avatarKey: string | null;
  bio: string | null;
  isFollowing: boolean;
}

interface FollowersListProps {
  followers: Follower[];
  currentUserId: string;
}

export default function FollowersList({ followers, currentUserId }: FollowersListProps) {
  const [followStates, setFollowStates] = useState<Record<string, boolean>>(
    followers.reduce((acc, follower) => ({
      ...acc,
      [follower.id]: follower.isFollowing
    }), {})
  );
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const router = useRouter();

  const handleFollowToggle = async (userId: string, currentlyFollowing: boolean) => {
    if (loading[userId]) return;
    
    setLoading(prev => ({ ...prev, [userId]: true }));
    
    try {
      const response = await fetch(`/api/follow/${userId}`, {
        method: currentlyFollowing ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        setFollowStates(prev => ({
          ...prev,
          [userId]: !currentlyFollowing
        }));
      } else {
        console.error('Failed to toggle follow');
      }
    } catch (error) {
      console.error('Error toggling follow:', error);
    } finally {
      setLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  const handleUserClick = (username: string | null) => {
    if (username) {
      router.push(`/u/${username}`);
    }
  };

  if (followers.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-muted-foreground text-lg">No followers yet</div>
        <p className="text-muted-foreground text-sm mt-2">
          When people follow you, they'll appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {followers.map((follower) => {
        const isFollowing = followStates[follower.id];
        const isLoading = loading[follower.id];
        const displayName = follower.displayName || follower.name || "User";
        const initials = displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

        return (
          <Card key={follower.id} className="p-4 hover:shadow-md transition-shadow">
            <div className="flex items-start space-x-3">
              <Avatar 
                className="h-12 w-12 cursor-pointer"
                onClick={() => handleUserClick(follower.username)}
              >
                <AvatarImage src={follower.avatarUrl || undefined} />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              
              <div className="flex-1 min-w-0">
                <div 
                  className="cursor-pointer"
                  onClick={() => handleUserClick(follower.username)}
                >
                  <h3 className="font-semibold text-foreground truncate">
                    {displayName}
                  </h3>
                  {follower.username && (
                    <p className="text-sm text-muted-foreground">@{follower.username}</p>
                  )}
                </div>
                
                {follower.bio && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {follower.bio}
                  </p>
                )}
              </div>
              
              <Button
                variant={isFollowing ? "outline" : "default"}
                size="sm"
                onClick={() => handleFollowToggle(follower.id, isFollowing)}
                disabled={isLoading}
                className="shrink-0"
              >
                {isLoading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                ) : isFollowing ? (
                  <>
                    <UserMinus className="h-4 w-4 mr-1" />
                    Following
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4 mr-1" />
                    Follow
                  </>
                )}
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
