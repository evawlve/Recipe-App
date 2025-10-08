import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const searchTerm = searchParams.get("s");

    // Build where clause for search
    const where = searchTerm
      ? {
          OR: [
            { slug: { contains: searchTerm, mode: "insensitive" as const } },
            { label: { contains: searchTerm, mode: "insensitive" as const } },
          ],
        }
      : {};

    // Query tags with popularity count
    const tags = await prisma.tag.findMany({
      where,
      take: 10,
      orderBy: [
        { recipes: { _count: "desc" } },
        { label: "asc" },
      ],
      include: {
        _count: {
          select: {
            recipes: true,
          },
        },
      },
    });

    // Transform the data to match the expected format
    const result = tags.map((tag) => ({
      id: tag.id,
      slug: tag.slug,
      label: tag.label,
      count: tag._count.recipes,
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching tags:", error);
    return NextResponse.json(
      { error: "Failed to fetch tags" },
      { status: 500 }
    );
  }
}
