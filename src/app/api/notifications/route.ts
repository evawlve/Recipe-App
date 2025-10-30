import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // Skip execution during build time
    if (process.env.NEXT_PHASE === 'phase-production-build' || 
        process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
        process.env.BUILD_TIME === 'true') {
      return NextResponse.json({ error: "Not available during build" }, { status: 503 });
    }

    // Import only when not in build mode
    const { prisma } = await import('@/lib/db');
    const { getCurrentUser } = await import('@/lib/auth');
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const after = searchParams.get('after');
    const limit = parseInt(searchParams.get('limit') || '20');

    const notifications = await prisma.notification.findMany({
      where: {
        userId: user.id,
        ...(after && {
          createdAt: {
            lt: new Date(after)
          }
        })
      },
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarKey: true
          }
        },
        recipe: {
          select: {
            id: true,
            title: true
          }
        },
        comment: {
          select: {
            id: true,
            body: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: limit
    });

    return NextResponse.json(notifications);
  } catch (error) {
    console.error('Notifications fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
