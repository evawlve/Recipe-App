import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { NotificationsList } from './NotificationsList';

// Force dynamic rendering for pages that use authentication
export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  
  if (!user) {
    redirect('/signin');
  }

  // Fetch first 20 notifications
  const notifications = await prisma.notification.findMany({
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

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
        <p className="text-gray-600">Stay updated with your activity</p>
      </div>
      
      <NotificationsList initialNotifications={notifications.map(notification => ({
        ...notification,
        type: notification.type as 'follow' | 'like' | 'comment' | 'save',
        createdAt: notification.createdAt.toISOString(),
        readAt: notification.readAt?.toISOString() || null,
        recipe: notification.recipe || undefined,
        comment: notification.comment || undefined,
      }))} />
    </div>
  );
}
