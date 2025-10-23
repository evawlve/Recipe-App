"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
async function GET(request) {
    try {
        const user = await (0, auth_1.getCurrentUser)();
        if (!user) {
            return server_1.NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const { searchParams } = new URL(request.url);
        const after = searchParams.get('after');
        const limit = parseInt(searchParams.get('limit') || '20');
        const notifications = await db_1.prisma.notification.findMany({
            where: {
                userId: user.id,
                ...(after && {
                    createdAt: {
                        lt: new Date(after)
                    }
                })
            },
            include: {
                actor: {
                    select: {
                        id: true,
                        username: true,
                        displayName: true,
                        avatarKey: true
                    }
                },
                recipe: {
                    select: {
                        id: true,
                        title: true
                    }
                },
                comment: {
                    select: {
                        id: true,
                        body: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: limit
        });
        return server_1.NextResponse.json(notifications);
    }
    catch (error) {
        console.error('Notifications fetch error:', error);
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
