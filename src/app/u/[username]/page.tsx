import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { optionalUser } from '@/lib/auth';
import { RecipeCard } from '@/components/recipe/RecipeCard';
import { FollowButton } from '@/components/account/FollowButton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';

interface UserProfilePageProps {
  params: {
    username: string;
  };
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
        take: 1,
        orderBy: { createdAt: 'asc' }
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
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 12
  });

  const displayName = user.displayName || user.name || user.username;

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Profile Header */}
      <Card className="mb-8">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            {/* Avatar */}
            <div className="relative w-24 h-24 rounded-full overflow-hidden bg-gray-100">
              {user.avatarKey ? (
                <Image
                  src={`/api/image/${user.avatarKey}`}
                  alt={displayName}
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="w-full h-full bg-green-100 flex items-center justify-center text-2xl font-bold text-green-600">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            {/* User Info */}
            <div className="flex-1">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                <h1 className="text-2xl font-bold text-gray-900">
                  {displayName}
                </h1>
                <Badge variant="secondary" className="w-fit">
                  @{user.username}
                </Badge>
              </div>
              
              {user.bio && (
                <p className="text-gray-600 mb-4">{user.bio}</p>
              )}

              {/* Stats */}
              <div className="flex gap-6 text-sm text-gray-600">
                <span><strong>{followers}</strong> Followers</span>
                <span><strong>{following}</strong> Following</span>
                <span><strong>{recipes}</strong> Recipes</span>
              </div>
            </div>

            {/* Follow Button */}
            {!isMe && me && (
              <div className="mt-4 md:mt-0">
                <FollowButton 
                  userId={user.id} 
                  initialFollowing={followingMe} 
                  initialFollowersCount={followers}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recipes Grid */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Recipes</h2>
        {userRecipes.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {userRecipes.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500">
            <p>No recipes yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
