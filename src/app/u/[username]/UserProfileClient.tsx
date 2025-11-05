'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RecipeCard } from '@/components/recipe/RecipeCard';
import { FollowButton } from '@/components/account/FollowButton';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import { User, Users, BookOpen } from 'lucide-react';

interface UserProfileClientProps {
  user: {
    id: string;
    username: string;
    displayName: string | null;
    bio: string | null;
    avatarKey: string | null;
    name: string | null;
  };
  me: {
    id: string;
    email: string;
    name?: string;
    avatarUrl?: string;
  } | null;
  isMe: boolean;
  followingMe: boolean;
  followers: number;
  following: number;
  recipes: number;
  userRecipes: any[];
  displayName: string;
}

export function UserProfileClient({
  user,
  me,
  isMe,
  followingMe,
  followers,
  following,
  recipes,
  userRecipes,
  displayName
}: UserProfileClientProps) {
  const router = useRouter();

  // Handle redirect to /me if user is viewing their own profile
  useEffect(() => {
    if (isMe) {
      router.replace('/me');
    }
  }, [isMe, router]);

  // If this is the user's own profile, show a loading state while redirecting
  if (isMe) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Redirecting to your profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Profile Header */}
        <Card className="mb-8 rounded-2xl border border-border bg-card shadow-sm">
          <CardContent className="p-8">
            <div className="flex flex-col lg:flex-row items-start lg:items-center gap-8">
              {/* Avatar */}
              <div className="relative w-32 h-32 rounded-full overflow-hidden bg-muted flex-shrink-0">
                {user.avatarKey ? (
                  <Image
                    src={`/api/image/${user.avatarKey}`}
                    alt={displayName || user.username || 'User'}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-primary/10 flex items-center justify-center text-4xl font-bold text-primary">
                    {(displayName || user.username || 'U').charAt(0).toUpperCase()}
                  </div>
                )}
              </div>

              {/* User Info */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
                  <h1 className="text-3xl font-bold text-foreground truncate">
                    {displayName}
                  </h1>
                  <Badge variant="secondary" className="w-fit text-sm">
                    @{user.username}
                  </Badge>
                </div>
                
                {user.bio && (
                  <p className="text-muted-foreground mb-6 max-w-2xl">{user.bio}</p>
                )}

                {/* Stats */}
                <div className="flex gap-8 text-sm">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-muted-foreground" />
                    <span className="font-semibold text-foreground">{followers}</span>
                    <span className="text-muted-foreground">Followers</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span className="font-semibold text-foreground">{following}</span>
                    <span className="text-muted-foreground">Following</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-muted-foreground" />
                    <span className="font-semibold text-foreground">{recipes}</span>
                    <span className="text-muted-foreground">Recipes</span>
                  </div>
                </div>
              </div>

              {/* Follow Button */}
              {!isMe && (
                <div className="flex-shrink-0">
                  <FollowButton 
                    userId={user.id} 
                    initialFollowing={followingMe} 
                    initialFollowersCount={followers}
                    isLoggedIn={!!me}
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recipes Section */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <BookOpen className="w-6 h-6" />
              Recipes
            </h2>
            {userRecipes.length > 0 && (
              <Badge variant="outline" className="text-sm">
                {userRecipes.length} recipe{userRecipes.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
          
          {userRecipes.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {userRecipes.map((recipe) => (
                <RecipeCard key={recipe.id} recipe={recipe} />
              ))}
            </div>
          ) : (
            <Card className="rounded-2xl border border-border bg-card">
              <CardContent className="p-12 text-center">
                <BookOpen className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">No recipes yet</h3>
                <p className="text-muted-foreground">
                  {isMe ? "Start sharing your favorite recipes!" : `${displayName} hasn't shared any recipes yet.`}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

