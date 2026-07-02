import { prisma } from '@/lib/db';

/**
 * Create or bump a follow notification
 * Uses upsert to prevent duplicates and update bumpedAt on repeat follows
 */
export async function notifyFollow({
  userId,
  actorId,
}: {
  userId: string;
  actorId: string;
}) {
  return prisma.notification.upsert({
    where: {
      userId_actorId_type: {
        userId,
        actorId,
        type: 'follow',
      },
    },
    update: {
      bumpedAt: new Date(),
      readAt: null, // Mark as unread when bumped
    },
    create: {
      userId,
      actorId,
      type: 'follow',
    },
  });
}

/**
 * Create or bump a like notification
 * Uses upsert to prevent duplicates and update bumpedAt on repeat likes
 */
export async function notifyLike({
  userId,
  actorId,
  recipeId,
}: {
  userId: string;
  actorId: string;
  recipeId: string;
}) {
  return prisma.notification.upsert({
    where: {
      userId_actorId_type_recipeId: {
        userId,
        actorId,
        type: 'like',
        recipeId,
      },
    },
    update: {
      bumpedAt: new Date(),
      readAt: null, // Mark as unread when bumped
    },
    create: {
      userId,
      actorId,
      type: 'like',
      recipeId,
    },
  });
}

/**
 * Create or bump a comment notification
 * Uses upsert to prevent duplicates and update bumpedAt on new comments
 */
export async function notifyComment({
  userId,
  commentId,
  actorId,
  recipeId,
}: {
  userId: string;
  commentId: string;
  actorId: string;
  recipeId: string;
}) {
  return prisma.notification.upsert({
    where: {
      userId_type_commentId: {
        userId,
        type: 'comment',
        commentId,
      },
    },
    update: {
      bumpedAt: new Date(),
      readAt: null, // Mark as unread when bumped
    },
    create: {
      userId,
      actorId,
      type: 'comment',
      recipeId,
      commentId,
    },
  });
}

