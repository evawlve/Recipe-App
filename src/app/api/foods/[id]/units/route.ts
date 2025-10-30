import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
		label: z.string().min(1),
		grams: z.number().positive(),
	});
	
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
