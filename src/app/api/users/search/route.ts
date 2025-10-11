import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    const exact = searchParams.get('exact');

    if (!q && !exact) {
      return NextResponse.json({ error: 'Query parameter required' }, { status: 400 });
    }

    const searchTerm = (q || exact)?.toLowerCase().trim();
    if (!searchTerm) {
      return NextResponse.json([]);
    }

    // For exact matches (used for username validation)
    if (exact) {
      const user = await prisma.user.findFirst({
        where: {
          username: {
            equals: searchTerm,
            mode: 'insensitive'
          }
        },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarKey: true,
        }
      });

      return NextResponse.json(user ? [user] : []);
    }

    // For search queries
    const users = await prisma.user.findMany({
      where: {
        OR: [
          {
            username: {
              contains: searchTerm,
              mode: 'insensitive'
            }
          },
          {
            displayName: {
              contains: searchTerm,
              mode: 'insensitive'
            }
          }
        ]
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarKey: true,
      },
      take: 10,
      orderBy: {
        username: 'asc'
      }
    });

    return NextResponse.json(users);

  } catch (error) {
    console.error('User search error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
