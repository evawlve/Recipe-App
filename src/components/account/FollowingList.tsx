"use client";

import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { UserMinus } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface FollowingUser {
  id: string;
  name: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  avatarKey: string | null;
  bio: string | null;
}

interface FollowingListProps {
  following: FollowingUser[];
  currentUserId: string;
}

export default function FollowingList({ following, currentUserId }: FollowingListProps) {
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [followingUsers, setFollowingUsers] = useState(following);
  const router = useRouter();

  const handleUnfollow = async (userId: string) => {
    if (loading[userId]) return;
    
    setLoading(prev => ({ ...prev, [userId]: true }));
    
    try {
      const response = await fetch(`/api/follow/${userId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        // Remove user from the list
        setFollowingUsers(prev => prev.filter(user => user.id !== userId));
      } else {
        console.error('Failed to unfollow');
      }
    } catch (error) {
      console.error('Error unfollowing:', error);
    } finally {
      setLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  const handleUserClick = (username: string | null) => {
    if (username) {
      router.push(`/u/${username}`);
    }
  };

  if (followingUsers.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-muted-foreground text-lg">Not following anyone yet</div>
        <p className="text-muted-foreground text-sm mt-2">
          When you follow people, they'll appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {followingUsers.map((user) => {
        const isLoading = loading[user.id];
        const displayName = user.displayName || user.name || "User";
        const initials = displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

        return (
          <Card key={user.id} className="p-4 hover:shadow-md transition-shadow">
            <div className="flex items-start space-x-3">
              <Avatar 
                className="h-12 w-12 cursor-pointer"
                onClick={() => handleUserClick(user.username)}
              >
                <AvatarImage src={user.avatarUrl || undefined} />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              
              <div className="flex-1 min-w-0">
                <div 
                  className="cursor-pointer"
                  onClick={() => handleUserClick(user.username)}
                >
                  <h3 className="font-semibold text-foreground truncate">
                    {displayName}
                  </h3>
                  {user.username && (
                    <p className="text-sm text-muted-foreground">@{user.username}</p>
                  )}
                </div>
                
                {user.bio && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {user.bio}
                  </p>
                )}
              </div>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleUnfollow(user.id)}
                disabled={isLoading}
                className="shrink-0"
              >
                {isLoading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                ) : (
                  <>
                    <UserMinus className="h-4 w-4 mr-1" />
                    Unfollow
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
