"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
async function GET() {
    try {
        const user = await (0, auth_1.getCurrentUser)();
        if (!user) {
            return server_1.NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const unreadCount = await db_1.prisma.notification.count({
            where: {
                userId: user.id,
                readAt: null
            }
        });
        return server_1.NextResponse.json({ unread: unreadCount });
    }
    catch (error) {
        console.error('Unread count error:', error);
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
