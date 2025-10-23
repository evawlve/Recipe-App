"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
async function GET(request, { params }) {
    try {
        const { username: rawUsername } = await params;
        const username = rawUsername.toLowerCase();
        const user = await db_1.prisma.user.findUnique({
            where: { username },
            select: {
                id: true,
                username: true,
                displayName: true,
                bio: true,
                avatarKey: true,
                name: true,
            }
        });
        if (!user) {
            return server_1.NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        // Get counts
        const [followers, following, recipes, likesReceived] = await Promise.all([
            db_1.prisma.follow.count({ where: { followingId: user.id } }),
            db_1.prisma.follow.count({ where: { followerId: user.id } }),
            db_1.prisma.recipe.count({ where: { authorId: user.id } }),
            db_1.prisma.like.count({
                where: {
                    recipe: {
                        authorId: user.id
                    }
                }
            })
        ]);
        return server_1.NextResponse.json({
            id: user.id,
            username: user.username,
            displayName: user.displayName || user.name,
            bio: user.bio,
            avatarKey: user.avatarKey,
            counts: {
                followers,
                following,
                recipes,
                likesReceived
            }
        });
    }
    catch (error) {
        console.error('User lookup error:', error);
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
