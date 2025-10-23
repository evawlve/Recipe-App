"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = NotificationsPage;
const navigation_1 = require("next/navigation");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const NotificationsList_1 = require("./NotificationsList");
async function NotificationsPage() {
    const user = await (0, auth_1.getCurrentUser)();
    if (!user) {
        (0, navigation_1.redirect)('/signin');
    }
    // Fetch first 20 notifications
    const notifications = await db_1.prisma.notification.findMany({
        where: {
            userId: user.id
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
        take: 20
    });
    return (<div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
        <p className="text-gray-600">Stay updated with your activity</p>
      </div>
      
      <NotificationsList_1.NotificationsList initialNotifications={notifications.map(notification => ({
            ...notification,
            type: notification.type,
            createdAt: notification.createdAt.toISOString(),
            readAt: notification.readAt?.toISOString() || null,
            recipe: notification.recipe || undefined,
            comment: notification.comment || undefined,
        }))}/>
    </div>);
}
