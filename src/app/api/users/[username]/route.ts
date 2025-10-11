import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username: rawUsername } = await params;
    const username = rawUsername.toLowerCase();

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
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get counts
    const [followers, following, recipes, likesReceived] = await Promise.all([
      prisma.follow.count({ where: { followingId: user.id } }),
      prisma.follow.count({ where: { followerId: user.id } }),
      prisma.recipe.count({ where: { authorId: user.id } }),
      prisma.like.count({
        where: {
          recipe: {
            authorId: user.id
          }
        }
      })
    ]);

    return NextResponse.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName || user.name,
      bio: user.bio,
      avatarKey: user.avatarKey,
      counts: {
        followers,
        following,
        recipes,
        likesReceived
      }
    });

  } catch (error) {
    console.error('User lookup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
