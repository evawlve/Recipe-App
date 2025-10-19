import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';

const Body = z.object({
  label: z.string().min(1),
  grams: z.number().positive(),
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
    const { label, grams } = parse.data;

    const { id } = await params;

    // Verify the food exists
    const food = await prisma.food.findUnique({
      where: { id }
    });

    if (!food) {
      return NextResponse.json({ error: 'Food not found' }, { status: 404 });
    }

    // Create the FoodUnit
    const foodUnit = await prisma.foodUnit.create({
      data: {
        foodId: id,
        label,
        grams,
      }
    });

    return NextResponse.json({ success: true, data: foodUnit }, { status: 201 });
  } catch (error) {
    console.error('FoodUnit creation error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create food unit' },
      { status: 500 }
    );
  }
}
