import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { deriveServingOptions } from '@/lib/units/servings';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
    }

    const f = await prisma.food.findUnique({
      where: { id },
      include: { units: true }
    });

    if (!f) {
      return NextResponse.json({ success: false, error: 'Food not found' }, { status: 404 });
    }

    const servingOptions = deriveServingOptions({
      units: f.units?.map(u => ({ label: u.label, grams: u.grams })),
      densityGml: f.densityGml ?? undefined,
      categoryId: f.categoryId ?? null,
    });

    return NextResponse.json({
      success: true,
      data: {
        id: f.id,
        name: f.name,
        brand: f.brand,
        categoryId: f.categoryId,
        source: f.source,
        verification: f.verification,
        densityGml: f.densityGml,
        kcal100: f.kcal100,
        protein100: f.protein100,
        carbs100: f.carbs100,
        fat100: f.fat100,
        fiber100: f.fiber100,
        sugar100: f.sugar100,
        popularity: f.popularity,
        servingOptions,
      }
    });
  } catch (error) {
    console.error('Food by id error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load food' }, { status: 500 });
  }
}


