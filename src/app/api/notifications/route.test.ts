import { NextRequest } from 'next/server';
import { GET } from './route';

// Mock the dependencies
jest.mock('@/lib/db', () => ({
  prisma: {
    notification: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getCurrentUser: jest.fn(),
}));

import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

const mockGetCurrentUser = getCurrentUser as jest.MockedFunction<typeof getCurrentUser>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('/api/notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 when user is not authenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/notifications');
    const response = await GET(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe('Unauthorized');
  });

  it('should return notifications for authenticated user', async () => {
    const mockUser = { id: 'user-1', email: 'test@example.com' };
    const mockNotifications = [
      {
        id: 'notif-1',
        type: 'follow',
        createdAt: new Date(),
        readAt: null,
        actor: {
          id: 'actor-1',
          username: 'testuser',
          displayName: 'Test User',
          avatarKey: null,
        },
        recipe: null,
        comment: null,
      },
    ];

    mockGetCurrentUser.mockResolvedValue(mockUser);
    mockPrisma.notification.findMany.mockResolvedValue(mockNotifications);

    const request = new NextRequest('http://localhost:3000/api/notifications');
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual(mockNotifications);
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
      },
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarKey: true,
          },
        },
        recipe: {
          select: {
            id: true,
            title: true,
          },
        },
        comment: {
          select: {
            id: true,
            body: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 20,
    });
  });

  it('should handle pagination with after parameter', async () => {
    const mockUser = { id: 'user-1', email: 'test@example.com' };
    mockGetCurrentUser.mockResolvedValue(mockUser);
    mockPrisma.notification.findMany.mockResolvedValue([]);

    const request = new NextRequest('http://localhost:3000/api/notifications?after=2023-01-01T00:00:00Z&limit=10');
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        createdAt: {
          lt: new Date('2023-01-01T00:00:00Z'),
        },
      },
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarKey: true,
          },
        },
        recipe: {
          select: {
            id: true,
            title: true,
          },
        },
        comment: {
          select: {
            id: true,
            body: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 10,
    });
  });
});
