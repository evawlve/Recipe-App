"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const server_2 = require("@/lib/supabase/server");
async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId');
        if (!userId) {
            return server_1.NextResponse.json({ error: 'userId parameter required' }, { status: 400 });
        }
        const supabase = await (0, server_2.createSupabaseServerClient)();
        const { data: { user } } = await supabase.auth.getUser();
        let following = false;
        if (user) {
            const follow = await db_1.prisma.follow.findUnique({
                where: {
                    followerId_followingId: {
                        followerId: user.id,
                        followingId: userId
                    }
                }
            });
            following = Boolean(follow);
        }
        // Get counts
        const [followers, followingCount] = await Promise.all([
            db_1.prisma.follow.count({ where: { followingId: userId } }),
            db_1.prisma.follow.count({ where: { followerId: userId } })
        ]);
        return server_1.NextResponse.json({
            following,
            followers,
            followingCount
        });
    }
    catch (error) {
        console.error('Follow state error:', error);
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
