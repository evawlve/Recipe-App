'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useNotificationsRT } from '@/hooks/useNotificationsRT';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // Get current user ID for realtime subscription
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }: { data: { user: any } }) => {
      setUserId(data.user?.id || null);
    });
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications/unread-count');
      if (response.ok) {
        const data = await response.json();
        setUnreadCount(data.unread);
      }
    } catch (error) {
      console.error('Failed to fetch unread count:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Realtime subscription - calls fetchUnreadCount when notifications change
  const { isConnected } = useNotificationsRT(userId, fetchUnreadCount);

  useEffect(() => {
    fetchUnreadCount();
    
    // Poll every 30 seconds as fallback (especially if realtime is not connected)
    const interval = setInterval(fetchUnreadCount, 30000);
    
    // Also refetch when window regains focus
    const handleFocus = () => fetchUnreadCount();
    window.addEventListener('focus', handleFocus);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchUnreadCount]);

  return (
    <Link href="/notifications" className="relative">
      <Bell className="h-6 w-6 text-gray-600 hover:text-gray-900 dark:text-white dark:hover:text-gray-200 transition-colors" />
      {!isLoading && unreadCount > 0 && (
        <Badge 
          variant="destructive" 
          className="absolute -top-2 -right-2 h-5 w-5 flex items-center justify-center text-xs p-0 min-w-[20px]"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </Badge>
      )}
    </Link>
  );
}
