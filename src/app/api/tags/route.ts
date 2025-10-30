import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
	// Skip execution during build time
	if (process.env.NEXT_PHASE === 'phase-production-build' || 
	    process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
	    process.env.BUILD_TIME === 'true') {
		return NextResponse.json({ error: "Not available during build" }, { status: 503 });
	}

	// Import only when not in build mode
	const { prisma } = await import("@/lib/db");
	const { getCurrentUser } = await import("@/lib/auth");
	
  try {
    const { searchParams } = new URL(request.url);
    const namespace = searchParams.get("namespace");
    const search = searchParams.get("s");

    // Handle search query (for TagsInput component)
    if (search) {
      const tags = await prisma.tag.findMany({
        where: {
          label: {
            contains: search,
            mode: 'insensitive'
          }
        },
        select: {
          id: true,
          slug: true,
          label: true,
          namespace: true
        },
        take: 10,
        orderBy: {
          label: 'asc'
        }
      });

      return NextResponse.json(tags);
    }

    // Handle namespace-specific queries (for TagChipSelect component)
    if (namespace) {
      // Validate namespace is a valid TagNamespace
      const validNamespaces = [
        "MEAL_TYPE",
        "CUISINE", 
        "DIET",
        "METHOD",
        "COURSE",
        "TIME",
        "DIFFICULTY",
        "OCCASION",
        "GOAL"
      ];

      if (!validNamespaces.includes(namespace)) {
        return NextResponse.json(
          { error: "Invalid namespace" },
          { status: 400 }
        );
      }

      let tags = await prisma.tag.findMany({
        where: {
          namespace: namespace as any
        },
        select: {
          id: true,
          slug: true,
          label: true,
          namespace: true
        }
      });

      // Custom ordering for MEAL_TYPE namespace
      if (namespace === 'MEAL_TYPE') {
        const order = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack', 'Drinks'];
        tags = tags.sort((a, b) => {
          const aIndex = order.indexOf(a.label);
          const bIndex = order.indexOf(b.label);
          return aIndex - bIndex;
        });
      } else {
        // Default alphabetical ordering for other namespaces
        tags = tags.sort((a, b) => a.label.localeCompare(b.label));
      }

      return NextResponse.json({ tags });
    }

    // Handle legacy requests (for TagFilters component) - return all tags with usage counts
    const tagsWithCounts = await prisma.tag.findMany({
      select: {
        id: true,
        slug: true,
        label: true,
        namespace: true,
        _count: {
          select: {
            recipes: true
          }
        }
      },
      orderBy: {
        recipes: {
          _count: 'desc'
        }
      }
    });

    // Transform to match expected format
    const popularTags = tagsWithCounts.map(tag => ({
      id: tag.id,
      slug: tag.slug,
      label: tag.label,
      count: tag._count.recipes
    }));

    return NextResponse.json(popularTags);
  } catch (error) {
    console.error("Error fetching tags:", error);
    return NextResponse.json(
      { error: "Failed to fetch tags" },
      { status: 500 }
    );
  }
}
