import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { buildImageUrl } from '@/lib/images';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const cursor = searchParams.get('cursor');
    const take = parseInt(searchParams.get('take') || '12');

    // Get current user (optional for For You feed)
    const user = await getCurrentUser();
    const userId = user?.id || null;

    // For You feed: Show trending/popular recipes
    // This is a simple implementation - in a real app you'd have more sophisticated algorithms
    const whereClause: any = {};
    
    if (cursor) {
      whereClause.id = { lt: cursor };
    }

    const recipes = await prisma.recipe.findMany({
      where: whereClause,
      select: {
        id: true,
        title: true,
        authorId: true,
        bodyMd: true,
        servings: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
        photos: { take: 1 },
        author: {
          select: {
            id: true,
            name: true,
            username: true,
            displayName: true,
            avatarKey: true,
          }
        },
        nutrition: true,
        _count: {
          select: {
            likes: true,
            comments: true
          }
        }
      },
      orderBy: [
        { createdAt: 'desc' }
      ],
      take: take + 1, // Take one extra to check if there are more
    });

    const hasMore = recipes.length > take;
    const items = hasMore ? recipes.slice(0, take) : recipes;
    const nextCursor = hasMore ? items[items.length - 1]?.id : null;

    return NextResponse.json({
      items: items.map(recipe => ({
        id: recipe.id,
        title: recipe.title,
        authorId: recipe.authorId,
        bodyMd: recipe.bodyMd,
        servings: recipe.servings,
        parentId: recipe.parentId,
        createdAt: recipe.createdAt,
        updatedAt: recipe.updatedAt,
        photos: recipe.photos,
        author: recipe.author,
        _count: recipe._count,
        nutrition: recipe.nutrition,
        savedByMe: false, // Will be handled by SaveButton component
        likedByMe: false  // Will be handled by RecipeCard component
      })),
      nextCursor
    });

  } catch (error) {
    console.error('For You feed error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
