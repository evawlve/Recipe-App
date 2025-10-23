"use strict";
'use client';
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsList = NotificationsList;
const react_1 = require("react");
const date_fns_1 = require("date-fns");
const card_1 = require("@/components/ui/card");
const badge_1 = require("@/components/ui/badge");
const avatar_1 = require("@/components/ui/avatar");
function NotificationsList({ initialNotifications }) {
    const [notifications, setNotifications] = (0, react_1.useState)(initialNotifications);
    const [isLoading, setIsLoading] = (0, react_1.useState)(false);
    // Auto-mark all notifications as read when component mounts
    (0, react_1.useEffect)(() => {
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
                    setNotifications(prev => prev.map(notification => ({ ...notification, readAt: new Date().toISOString() })));
                }
            }
            catch (error) {
                console.error('Failed to mark all notifications as read:', error);
            }
        };
        markAllAsRead();
    }, []);
    const markAsRead = async (notificationIds) => {
        try {
            const response = await fetch('/api/notifications/read', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ids: notificationIds }),
            });
            if (response.ok) {
                setNotifications(prev => prev.map(notification => notificationIds.includes(notification.id)
                    ? { ...notification, readAt: new Date().toISOString() }
                    : notification));
            }
        }
        catch (error) {
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
                setNotifications(prev => prev.map(notification => ({ ...notification, readAt: new Date().toISOString() })));
            }
        }
        catch (error) {
            console.error('Failed to mark all notifications as read:', error);
        }
        finally {
            setIsLoading(false);
        }
    };
    const getNotificationText = (notification) => {
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
    const getNotificationLink = (notification) => {
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
    const getAvatarUrl = (avatarKey) => {
        if (!avatarKey)
            return undefined;
        return `/api/image/${avatarKey}`;
    };
    const getInitials = (displayName, username) => {
        if (displayName) {
            return displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
        }
        if (username) {
            return username.slice(0, 2).toUpperCase();
        }
        return 'U';
    };
    if (notifications.length === 0) {
        return (<div className="text-center py-12">
        <p className="text-muted-foreground text-lg">No notifications yet</p>
        <p className="text-muted-foreground/70">You'll see notifications here when people interact with your content</p>
      </div>);
    }
    return (<div className="space-y-4">

      <div className="space-y-3">
        {notifications.map((notification) => {
            const userProfileLink = `/u/${notification.actor.username}`;
            const notificationLink = getNotificationLink(notification);
            const handleCardClick = () => {
                window.location.href = notificationLink;
            };
            const handleUserClick = (e) => {
                e.stopPropagation();
                window.location.href = userProfileLink;
            };
            return (<card_1.Card key={notification.id} className={`transition-colors hover:bg-muted/50 cursor-pointer ${!notification.readAt ? 'bg-primary/5 border-primary/20' : ''}`} onClick={handleCardClick}>
              <card_1.CardContent className="p-4">
                <div className="flex items-start space-x-3">
                  <button onClick={handleUserClick} className="flex-shrink-0 hover:opacity-80 transition-opacity">
                    <avatar_1.Avatar className="h-10 w-10">
                      <avatar_1.AvatarImage src={getAvatarUrl(notification.actor.avatarKey)}/>
                      <avatar_1.AvatarFallback>
                        {getInitials(notification.actor.displayName, notification.actor.username)}
                      </avatar_1.AvatarFallback>
                    </avatar_1.Avatar>
                  </button>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <p className="text-sm text-foreground">
                        <button onClick={handleUserClick} className="font-medium hover:underline text-primary">
                          {notification.actor.displayName || notification.actor.username || 'Someone'}
                        </button>
                        <span className="text-muted-foreground">
                          {getNotificationText(notification)}
                        </span>
                      </p>
                      {!notification.readAt && (<badge_1.Badge variant="destructive" className="h-2 w-2 p-0"/>)}
                    </div>
                    
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-muted-foreground">
                        {(0, date_fns_1.formatDistanceToNow)(new Date(notification.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                </div>
              </card_1.CardContent>
            </card_1.Card>);
        })}
      </div>
    </div>);
}
