'use client';

import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Link from 'next/link';

interface Notification {
  id: string;
  type: 'follow' | 'like' | 'comment' | 'save';
  createdAt: string;
  bumpedAt: string;
  readAt: string | null;
  actor: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarKey: string | null;
  };
  recipe?: {
    id: string;
    title: string;
  };
  comment?: {
    id: string;
    body: string;
  };
}

interface NotificationsListProps {
  initialNotifications: Notification[];
}

export function NotificationsList({ initialNotifications }: NotificationsListProps) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [isLoading, setIsLoading] = useState(false);

  // Auto-mark all notifications as read when component mounts
  useEffect(() => {
    const markAllAsRead = async () => {
      try {
        const response = await fetch('/api/notifications/read', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        if (response.ok) {
          setNotifications(prev => 
            prev.map(notification => ({ ...notification, readAt: new Date().toISOString() }))
          );
        }
      } catch (error) {
        console.error('Failed to mark all notifications as read:', error);
      }
    };

    markAllAsRead();
  }, []);

  const markAsRead = async (notificationIds: string[]) => {
    try {
      const response = await fetch('/api/notifications/read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: notificationIds }),
      });

      if (response.ok) {
        setNotifications(prev => 
          prev.map(notification => 
            notificationIds.includes(notification.id)
              ? { ...notification, readAt: new Date().toISOString() }
              : notification
          )
        );
      }
    } catch (error) {
      console.error('Failed to mark notifications as read:', error);
    }
  };

  const markAllAsRead = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/notifications/read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (response.ok) {
        setNotifications(prev => 
          prev.map(notification => ({ ...notification, readAt: new Date().toISOString() }))
        );
      }
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getNotificationText = (notification: Notification) => {
    const actorName = notification.actor.displayName || notification.actor.username || 'Someone';
    
    switch (notification.type) {
      case 'follow':
        return ` started following you`;
      case 'like':
        return ` liked your recipe "${notification.recipe?.title}"`;
      case 'comment':
        return ` commented on "${notification.recipe?.title}": "${notification.comment?.body?.substring(0, 50)}${notification.comment?.body && notification.comment.body.length > 50 ? '...' : ''}"`;
      case 'save':
        return ` saved your recipe "${notification.recipe?.title}"`;
      default:
        return 'New notification';
    }
  };

  const getNotificationLink = (notification: Notification) => {
    switch (notification.type) {
      case 'follow':
        return `/me`;
      case 'like':
      case 'comment':
      case 'save':
        return `/recipes/${notification.recipe?.id}`;
      default:
        return '#';
    }
  };

  const getAvatarUrl = (avatarKey: string | null) => {
    if (!avatarKey) return undefined;
    return `/api/image/${avatarKey}`;
  };

  const getInitials = (displayName: string | null, username: string | null) => {
    if (displayName) {
      return displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    if (username) {
      return username.slice(0, 2).toUpperCase();
    }
    return 'U';
  };

  if (notifications.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground text-lg">No notifications yet</p>
        <p className="text-muted-foreground/70">You'll see notifications here when people interact with your content</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      <div className="space-y-3">
        {notifications.map((notification) => {
          const userProfileLink = `/u/${notification.actor.username}`;
          const notificationLink = getNotificationLink(notification);
          
          const handleCardClick = () => {
            window.location.href = notificationLink;
          };
          
          const handleUserClick = (e: React.MouseEvent) => {
            e.stopPropagation();
            window.location.href = userProfileLink;
          };
          
          return (
            <Card 
              key={notification.id}
              className={`transition-colors hover:bg-muted/50 cursor-pointer ${
                !notification.readAt ? 'bg-primary/5 border-primary/20' : ''
              }`}
              onClick={handleCardClick}
            >
              <CardContent className="p-4">
                <div className="flex items-start space-x-3">
                  <button 
                    onClick={handleUserClick}
                    className="flex-shrink-0 hover:opacity-80 transition-opacity"
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={getAvatarUrl(notification.actor.avatarKey)} />
                      <AvatarFallback>
                        {getInitials(notification.actor.displayName, notification.actor.username)}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <p className="text-sm text-foreground">
                        <button 
                          onClick={handleUserClick}
                          className="font-medium hover:underline text-primary"
                        >
                          {notification.actor.displayName || notification.actor.username || 'Someone'}
                        </button>
                        <span className="text-muted-foreground">
                          {getNotificationText(notification)}
                        </span>
                      </p>
                      {!notification.readAt && (
                        <Badge variant="destructive" className="h-2 w-2 p-0" />
                      )}
                    </div>
                    
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(notification.bumpedAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
