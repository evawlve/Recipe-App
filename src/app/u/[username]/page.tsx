import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { optionalUser } from '@/lib/auth';
import { RecipeCard } from '@/components/recipe/RecipeCard';
import { FollowButton } from '@/components/account/FollowButton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Image from 'next/image';
import { User, Users, BookOpen, Heart, MessageCircle } from 'lucide-react';

interface UserProfilePageProps {
  params: Promise<{
    username: string;
  }>;
}

export default async function UserProfilePage({ params }: UserProfilePageProps) {
  const { username: rawUsername } = await params;
  const username = rawUsername.toLowerCase();

  // Load user by username
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      displayName: true,
      bio: true,
      avatarKey: true,
      name: true,
    }
  });

  if (!user) {
    notFound();
  }

  // Get current viewer
  const me = await optionalUser();
  const isMe = me?.id === user.id;
  
  // If user is trying to access their own profile, redirect to /me
  if (isMe) {
    redirect('/me');
  }
  
  // Check if current user is following this user
  const followingMe = me ? Boolean(await prisma.follow.findUnique({ 
    where: { 
      followerId_followingId: { 
        followerId: me.id, 
        followingId: user.id 
      }
    }
  })) : false;

  // Compute counts
  const [followers, following, recipes] = await Promise.all([
    prisma.follow.count({ where: { followingId: user.id } }),
    prisma.follow.count({ where: { followerId: user.id } }),
    prisma.recipe.count({ where: { authorId: user.id } })
  ]);

  // Load their latest 12 recipes with cover photo
  const userRecipes = await prisma.recipe.findMany({
    where: { authorId: user.id },
    include: {
      photos: {
        take: 1
      },
      author: {
        select: {
          id: true,
          username: true,
          displayName: true,
          name: true,
          avatarKey: true,
        }
      },
      _count: {
        select: {
          likes: true,
          comments: true
        }
      },
      nutrition: true
    },
    orderBy: { createdAt: 'desc' },
    take: 12
  });

  const displayName = user.displayName || user.name || user.username;

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
