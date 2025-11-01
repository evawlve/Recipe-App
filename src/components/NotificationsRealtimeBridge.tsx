'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNotificationsRT } from '@/hooks/useNotificationsRT';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Client-side bridge component to enable realtime updates on the notifications page
 * Refreshes the page data when notification changes occur
 */
export function NotificationsRealtimeBridge() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);

  // Get current user ID for realtime subscription
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }: { data: { user: any } }) => {
      setUserId(data.user?.id || null);
    });
  }, []);

  // Subscribe to notification changes and refresh the page when they occur
  const { isConnected } = useNotificationsRT(
    userId,
    () => {
      console.log('[NotificationsPage] Realtime update detected, refreshing...');
      router.refresh();
    }
  );

  // Optional: Show connection status in development
  if (process.env.NODE_ENV === 'development' && isConnected) {
    console.log('[NotificationsPage] Realtime connected');
  }

  return null; // This is a bridge component, no UI needed
}

