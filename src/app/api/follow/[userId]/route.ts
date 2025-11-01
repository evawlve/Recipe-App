import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
import { createSupabaseServerClient } from '@/lib/supabase/server';


export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
	// Skip execution during build time
	if (process.env.NEXT_PHASE === 'phase-production-build' || 
	    process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
	    process.env.BUILD_TIME === 'true') {
		return NextResponse.json({ error: "Not available during build" }, { status: 503 });
	}

	// Import only when not in build mode
	const { prisma } = await import("@/lib/db");
	const { getCurrentUser } = await import("@/lib/auth");
	
  try {
    const { userId: targetUserId } = await params;
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Can't follow yourself
    if (user.id === targetUserId) {
      return NextResponse.json({ error: 'Cannot follow yourself' }, { status: 400 });
    }

    // Check if target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId }
    });

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Upsert follow relationship
    await prisma.follow.upsert({
      where: {
        followerId_followingId: {
          followerId: user.id,
          followingId: targetUserId
        }
      },
      update: {},
      create: {
        followerId: user.id,
        followingId: targetUserId
      }
    });

    // Create notification for the followed user
    const { notifyFollow } = await import('@/lib/notifications/create');
    await notifyFollow({
      userId: targetUserId,
      actorId: user.id,
    });

    // Get updated follower count
    const followersCount = await prisma.follow.count({
      where: { followingId: targetUserId }
    });

    return NextResponse.json({
      following: true,
      followers: followersCount
    });

  } catch (error) {
    console.error('Follow error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
	// Skip execution during build time
	if (process.env.NEXT_PHASE === 'phase-production-build' || 
	    process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
	    process.env.BUILD_TIME === 'true') {
		return NextResponse.json({ error: "Not available during build" }, { status: 503 });
	}

	// Import only when not in build mode
	const { prisma } = await import("@/lib/db");
	const { getCurrentUser } = await import("@/lib/auth");
	
  try {
    const { userId: targetUserId } = await params;
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Delete follow relationship
    await prisma.follow.deleteMany({
      where: {
        followerId: user.id,
        followingId: targetUserId
      }
    });

    // Get updated follower count
    const followersCount = await prisma.follow.count({
      where: { followingId: targetUserId }
    });

    return NextResponse.json({
      following: false,
      followers: followersCount
    });

  } catch (error) {
    console.error('Unfollow error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
