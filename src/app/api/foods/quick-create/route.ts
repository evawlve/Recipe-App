import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
function generateAutoAliases(name: string): string[] {
  const aliases: string[] = [];
  const lowerName = name.toLowerCase();
  
  // Fat-related terms and their aliases
  const fatTerms = [
    { patterns: ['nonfat', 'no fat', '0% fat'], aliases: ['fat free', 'zero fat', 'no fat', 'nonfat'] },
    { patterns: ['low fat', 'lowfat', 'low-fat'], aliases: ['low fat', 'lowfat', 'reduced fat', 'light'] },
    { patterns: ['fat reduced', 'reduced fat'], aliases: ['reduced fat', 'fat reduced', 'low fat', 'light'] },
    { patterns: ['light'], aliases: ['light', 'low fat', 'reduced fat'] },
    { patterns: ['lean'], aliases: ['lean', 'low fat'] }
  ];
  
  for (const term of fatTerms) {
    for (const pattern of term.patterns) {
      if (lowerName.includes(pattern)) {
        aliases.push(...term.aliases);
        break; // Only add aliases for the first matching pattern
      }
    }
  }
  
  // Remove duplicates and the original name
  return [...new Set(aliases)].filter(alias => alias.toLowerCase() !== lowerName);
}

export async function POST(req: NextRequest) {
	// Skip execution during build time
	if (process.env.NEXT_PHASE === 'phase-production-build' || 
	    process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
	    process.env.BUILD_TIME === 'true') {
		return NextResponse.json({ error: "Not available during build" }, { status: 503 });
	}

	// Import only when not in build mode
	const { prisma } = await import("@/lib/db");
	const { getCurrentUser } = await import("@/lib/auth");
	const { z } = await import("zod");

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
		sodium: z.number().min(0).max(5000).optional(),
		densityGml: z.number().positive().optional(),
		aliases: z.array(z.string().min(1)).optional(),
	});
	
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

    const user = await getCurrentUser();
    const userId = user?.id || null;

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

    // Auto-create aliases for fat-related terms
    const autoAliases = generateAutoAliases(b.name);
    if (autoAliases.length > 0) {
      try {
        await prisma.foodAlias.createMany({
          data: autoAliases.map(alias => ({
            foodId: food.id,
            alias: alias
          })),
          skipDuplicates: true
        });
      } catch (error) {
        console.warn('Failed to create auto-aliases:', error);
        // Don't fail the food creation if aliases fail
      }
    }

    return NextResponse.json({ success: true, foodId: food.id }, { status: 201 });
  } catch (error) {
    console.error('Quick create error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create food' },
      { status: 500 }
    );
  }
}
