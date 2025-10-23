"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const q = searchParams.get('q');
        const exact = searchParams.get('exact');
        if (!q && !exact) {
            return server_1.NextResponse.json({ error: 'Query parameter required' }, { status: 400 });
        }
        const searchTerm = (q || exact)?.toLowerCase().trim();
        if (!searchTerm) {
            return server_1.NextResponse.json([]);
        }
        // For exact matches (used for username validation)
        if (exact) {
            const user = await db_1.prisma.user.findFirst({
                where: {
                    username: {
                        equals: searchTerm,
                        mode: 'insensitive'
                    }
                },
                select: {
                    id: true,
                    username: true,
                    displayName: true,
                    avatarKey: true,
                }
            });
            return server_1.NextResponse.json(user ? [user] : []);
        }
        // For search queries
        const users = await db_1.prisma.user.findMany({
            where: {
                OR: [
                    {
                        username: {
                            contains: searchTerm,
                            mode: 'insensitive'
                        }
                    },
                    {
                        displayName: {
                            contains: searchTerm,
                            mode: 'insensitive'
                        }
                    }
                ]
            },
            select: {
                id: true,
                username: true,
                displayName: true,
                avatarKey: true,
            },
            take: 10,
            orderBy: {
                username: 'asc'
            }
        });
        return server_1.NextResponse.json(users);
    }
    catch (error) {
        console.error('User search error:', error);
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
