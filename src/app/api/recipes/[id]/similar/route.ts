import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // First try to get similar recipes from the co-view graph
    const sims = await prisma.recipeSimilar.findMany({
      where: { recipeId: id },
      orderBy: { score: 'desc' },
      take: 10,
      select: { similarId: true },
    });

    let ids = sims.map(s => s.similarId);
    
    // Cold-start fallback if no similar recipes found
    if (ids.length === 0) {
      console.log(`No similar recipes found for ${id}, using cold-start fallback`);
      
      // Get current recipe's tags for fallback
      const base = await prisma.recipe.findUnique({
        where: { id },
        select: { 
          tags: { 
            include: { 
              tag: { 
                select: { slug: true, namespace: true } 
              } 
            } 
          } 
        },
      });
      
      if (base?.tags) {
        // Filter for meal type, cuisine, and goal tags
        const relevantTags = base.tags
          .filter(rt => 
            ['MEAL_TYPE', 'CUISINE', 'GOAL'].includes(rt.tag.namespace) &&
            ['breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'drinks', 
             'mexican', 'italian', 'american', 'japanese', 'greek', 'chinese',
             'pre_workout', 'post_workout', 'weight_loss', 'muscle_gain', 'maintenance']
            .includes(rt.tag.slug)
          )
          .map(rt => rt.tag.slug);
        
        if (relevantTags.length > 0) {
          // Find recipes with similar tags, ordered by recent interactions
          const fallback = await prisma.recipe.findMany({
            where: {
              id: { not: id },
              AND: relevantTags.map(slug => ({ 
                tags: { 
                  some: { 
                    tag: { slug } 
                  } 
                } 
              })),
            },
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: { id: true },
          });
          
          ids = fallback.map(f => f.id);
          console.log(`Cold-start fallback found ${ids.length} recipes with similar tags`);
        }
      }
      
      // If still no results, get recent popular recipes
      if (ids.length === 0) {
        console.log('No tag-based fallback found, using recent popular recipes');
        const recent = await prisma.recipe.findMany({
          where: { id: { not: id } },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true },
        });
        ids = recent.map(r => r.id);
      }
    }

    if (ids.length === 0) {
      return NextResponse.json({ items: [] });
    }

    // Fetch full recipe data
    const recipes = await prisma.recipe.findMany({
      where: { id: { in: ids } },
      include: {
        photos: {
          select: {
            id: true,
            s3Key: true,
            width: true,
            height: true,
          },
          take: 1
        },
        author: {
          select: {
            id: true,
            name: true,
            username: true,
            displayName: true,
            avatarKey: true,
          }
        },
        tags: { 
          include: { 
            tag: {
              select: {
                id: true,
                slug: true,
                label: true,
              }
            } 
          } 
        },
        nutrition: {
          select: {
            calories: true,
            proteinG: true,
            carbsG: true,
            fatG: true,
          }
        },
        _count: {
          select: { likes: true, comments: true },
        },
      },
    });

    // Keep original order of ids (similarity order)
    const byId = new Map(recipes.map(r => [r.id, r]));
    const ordered = ids.map(i => byId.get(i)).filter(Boolean);

    return NextResponse.json({ items: ordered });
    
  } catch (error) {
    console.error('Error fetching similar recipes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch similar recipes' },
      { status: 500 }
    );
  }
}
