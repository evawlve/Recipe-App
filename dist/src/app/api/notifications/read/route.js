"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
async function POST(request) {
    try {
        const user = await (0, auth_1.getCurrentUser)();
        if (!user) {
            return server_1.NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const body = await request.json().catch(() => ({}));
        const { ids } = body;
        if (ids && Array.isArray(ids)) {
            // Mark specific notifications as read
            await db_1.prisma.notification.updateMany({
                where: {
                    id: { in: ids },
                    userId: user.id
                },
                data: {
                    readAt: new Date()
                }
            });
        }
        else {
            // Mark all unread notifications as read
            await db_1.prisma.notification.updateMany({
                where: {
                    userId: user.id,
                    readAt: null
                },
                data: {
                    readAt: new Date()
                }
            });
        }
        // Get updated unread count
        const unreadCount = await db_1.prisma.notification.count({
            where: {
                userId: user.id,
                readAt: null
            }
        });
        return server_1.NextResponse.json({ ok: true, unread: unreadCount });
    }
    catch (error) {
        console.error('Mark notifications as read error:', error);
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
