import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';

const Body = z.object({
  name: z.string().min(2),
  brand: z.string().trim().optional(),
  categoryId: z.string().optional(),
  servingLabel: z.string().min(1),
  gramsPerServing: z.number().positive().optional(),
  kcal: z.number().min(0).max(1200),
  protein: z.number().min(0).max(120),
  carbs: z.number().min(0).max(200),
  fat: z.number().min(0).max(120),
  fiber: z.number().min(0).max(60).optional(),
  sugar: z.number().min(0).max(150).optional(),
  densityGml: z.number().positive().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const parse = Body.safeParse(await req.json());
    if (!parse.success) {
      return NextResponse.json({ 
        success: false, 
        error: parse.error.flatten() 
      }, { status: 400 });
    }
    const b = parse.data;

    const grams =
      b.gramsPerServing ??
      (b.servingLabel.match(/(\d+(\.\d+)?)\s*g$/i) ? parseFloat(RegExp.$1) : NaN);
    if (!grams || !isFinite(grams)) {
      return NextResponse.json({ 
        success: false, 
        error: 'gramsPerServing required or inferable from servingLabel (e.g., "100 g")' 
      }, { status: 400 });
    }

    // derive per-100g
    const to100 = (x?: number | null) => (x ?? 0) / grams * 100;
    const kcal100 = to100(b.kcal);
    if (kcal100 < 0 || kcal100 > 1200) {
      return NextResponse.json({ 
        success: false, 
        error: 'implausible kcal/100g' 
      }, { status: 422 });
    }

    const userId = req.headers.get('x-user-id') || null;

    const food = await prisma.food.create({
      data: {
        name: b.name,
        brand: b.brand ?? null,
        categoryId: b.categoryId ?? null,
        source: 'community',
        verification: 'unverified',
        densityGml: b.densityGml ?? null,
        kcal100,
        protein100: to100(b.protein),
        carbs100: to100(b.carbs),
        fat100: to100(b.fat),
        fiber100: b.fiber != null ? to100(b.fiber) : null,
        sugar100: b.sugar != null ? to100(b.sugar) : null,
        createdById: userId,
        popularity: 0,
        units: { create: [{ label: b.servingLabel, grams }] },
      },
      select: { id: true },
    });

    return NextResponse.json({ success: true, foodId: food.id }, { status: 201 });
  } catch (error) {
    console.error('Quick create error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create food' },
      { status: 500 }
    );
  }
}
