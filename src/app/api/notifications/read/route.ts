import { NextRequest, NextResponse } from 'next/server';
export async function POST(request: NextRequest) {
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
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { ids } = body;

    if (ids && Array.isArray(ids)) {
      // Mark specific notifications as read
      await prisma.notification.updateMany({
        where: {
          id: { in: ids },
          userId: user.id
        },
        data: {
          readAt: new Date()
        }
      });
    } else {
      // Mark all unread notifications as read
      await prisma.notification.updateMany({
        where: {
          userId: user.id,
          readAt: null
        },
        data: {
          readAt: new Date()
        }
      });
    }

    // Get updated unread count
    const unreadCount = await prisma.notification.count({
      where: {
        userId: user.id,
        readAt: null
      }
    });

    return NextResponse.json({ ok: true, unread: unreadCount });
  } catch (error) {
    console.error('Mark notifications as read error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
