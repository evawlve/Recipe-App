"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const server_2 = require("@/lib/supabase/server");
async function POST(request, { params }) {
    try {
        const { userId: targetUserId } = await params;
        const supabase = await (0, server_2.createSupabaseServerClient)();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return server_1.NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        // Can't follow yourself
        if (user.id === targetUserId) {
            return server_1.NextResponse.json({ error: 'Cannot follow yourself' }, { status: 400 });
        }
        // Check if target user exists
        const targetUser = await db_1.prisma.user.findUnique({
            where: { id: targetUserId }
        });
        if (!targetUser) {
            return server_1.NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        // Upsert follow relationship
        await db_1.prisma.follow.upsert({
            where: {
                followerId_followingId: {
                    followerId: user.id,
                    followingId: targetUserId
                }
            },
            update: {},
            create: {
                followerId: user.id,
                followingId: targetUserId
            }
        });
        // Create notification for the followed user
        await db_1.prisma.notification.create({
            data: {
                userId: targetUserId,
                actorId: user.id,
                type: 'follow'
            }
        });
        // Get updated follower count
        const followersCount = await db_1.prisma.follow.count({
            where: { followingId: targetUserId }
        });
        return server_1.NextResponse.json({
            following: true,
            followers: followersCount
        });
    }
    catch (error) {
        console.error('Follow error:', error);
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
async function DELETE(request, { params }) {
    try {
        const { userId: targetUserId } = await params;
        const supabase = await (0, server_2.createSupabaseServerClient)();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return server_1.NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        // Delete follow relationship
        await db_1.prisma.follow.deleteMany({
            where: {
                followerId: user.id,
                followingId: targetUserId
            }
        });
        // Get updated follower count
        const followersCount = await db_1.prisma.follow.count({
            where: { followingId: targetUserId }
        });
        return server_1.NextResponse.json({
            following: false,
            followers: followersCount
        });
    }
    catch (error) {
        console.error('Unfollow error:', error);
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
