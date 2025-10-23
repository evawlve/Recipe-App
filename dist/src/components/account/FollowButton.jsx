"use strict";
'use client';
Object.defineProperty(exports, "__esModule", { value: true });
exports.FollowButton = FollowButton;
const react_1 = require("react");
const navigation_1 = require("next/navigation");
const button_1 = require("@/components/ui/button");
function FollowButton({ userId, initialFollowing, initialFollowersCount, isLoggedIn = true }) {
    const [following, setFollowing] = (0, react_1.useState)(initialFollowing);
    const [followersCount, setFollowersCount] = (0, react_1.useState)(initialFollowersCount);
    const [isLoading, setIsLoading] = (0, react_1.useState)(false);
    const router = (0, navigation_1.useRouter)();
    const handleFollow = async () => {
        if (isLoading)
            return;
        // If not logged in, redirect to login page
        if (!isLoggedIn) {
            router.push('/signin');
            return;
        }
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
        }
        catch (error) {
            // Revert optimistic update on error
            setFollowing(previousFollowing);
            setFollowersCount(previousCount);
            console.error('Follow/unfollow error:', error);
        }
        finally {
            setIsLoading(false);
        }
    };
    return (<button_1.Button onClick={handleFollow} disabled={isLoading} variant={following ? 'outline' : 'default'} className="min-w-[100px]" title={!isLoggedIn ? 'Sign in to follow this user' : undefined}>
      {isLoading ? '...' : following ? 'Following' : 'Follow'}
    </button_1.Button>);
}
