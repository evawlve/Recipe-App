"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const searchTerm = searchParams.get("s");
        // Build where clause for search
        const where = searchTerm
            ? {
                OR: [
                    { slug: { contains: searchTerm, mode: "insensitive" } },
                    { label: { contains: searchTerm, mode: "insensitive" } },
                ],
            }
            : {};
        // Query tags with popularity count
        const tags = await db_1.prisma.tag.findMany({
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
        return server_1.NextResponse.json(result);
    }
    catch (error) {
        console.error("Error fetching tags:", error);
        return server_1.NextResponse.json({ error: "Failed to fetch tags" }, { status: 500 });
    }
}
