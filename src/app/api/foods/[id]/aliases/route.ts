import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';

const Body = z.object({
  aliases: z.array(z.string().min(1)).min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parse = Body.safeParse(await req.json());
    if (!parse.success) {
      return NextResponse.json({ 
        success: false, 
        error: parse.error.flatten() 
      }, { status: 400 });
    }
    const { aliases } = parse.data;

    const { id } = await params;

    // Verify the food exists
    const food = await prisma.food.findUnique({
      where: { id }
    });

    if (!food) {
      return NextResponse.json({ error: 'Food not found' }, { status: 404 });
    }

    // Create aliases (using upsert to avoid duplicates)
    const createdAliases = [];
    for (const alias of aliases) {
      try {
        const foodAlias = await prisma.foodAlias.upsert({
          where: {
            foodId_alias: {
              foodId: id,
              alias: alias.trim()
            }
          },
          update: {},
          create: {
            foodId: id,
            alias: alias.trim()
          }
        });
        createdAliases.push(foodAlias);
      } catch (error) {
        // Skip if alias already exists or other constraint error
        console.warn(`Skipping alias "${alias}" for food ${id}:`, error);
      }
    }

    return NextResponse.json({ 
      success: true, 
      data: createdAliases,
      count: createdAliases.length 
    }, { status: 201 });
  } catch (error) {
    console.error('FoodAlias creation error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create food aliases' },
      { status: 500 }
    );
  }
}
