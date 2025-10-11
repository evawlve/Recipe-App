'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface FollowButtonProps {
  userId: string;
  initialFollowing: boolean;
  initialFollowersCount: number;
}

export function FollowButton({ userId, initialFollowing, initialFollowersCount }: FollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [followersCount, setFollowersCount] = useState(initialFollowersCount);
  const [isLoading, setIsLoading] = useState(false);

  const handleFollow = async () => {
    if (isLoading) return;

    setIsLoading(true);
    const previousFollowing = following;
    const previousCount = followersCount;

    // Optimistic update
    setFollowing(!following);
    setFollowersCount(following ? followersCount - 1 : followersCount + 1);

    try {
      const response = following 
        ? await fetch(`/api/follow/${userId}`, { method: 'DELETE' })
        : await fetch(`/api/follow/${userId}`, { method: 'POST' });

      if (!response.ok) {
        throw new Error('Failed to update follow status');
      }

      const data = await response.json();
      setFollowing(data.following);
      setFollowersCount(data.followers);
    } catch (error) {
      // Revert optimistic update on error
      setFollowing(previousFollowing);
      setFollowersCount(previousCount);
      console.error('Follow/unfollow error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      onClick={handleFollow}
      disabled={isLoading}
      variant={following ? 'outline' : 'default'}
      className="min-w-[100px]"
    >
      {isLoading ? '...' : following ? 'Following' : 'Follow'}
    </Button>
  );
}
