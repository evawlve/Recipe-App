import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId parameter required' }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    let following = false;
    if (user) {
      const follow = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: user.id,
            followingId: userId
          }
        }
      });
      following = Boolean(follow);
    }

    // Get counts
    const [followers, followingCount] = await Promise.all([
      prisma.follow.count({ where: { followingId: userId } }),
      prisma.follow.count({ where: { followerId: userId } })
    ]);

    return NextResponse.json({
      following,
      followers,
      followingCount
    });

  } catch (error) {
    console.error('Follow state error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
