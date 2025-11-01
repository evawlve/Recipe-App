'use client';

import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Hook to subscribe to realtime notification changes for the current user
 * @param userId - The ID of the current user to filter notifications
 * @param onNotification - Callback fired when a notification change occurs
 * @param enabled - Whether the subscription is active (default: true)
 */
export function useNotificationsRT(
  userId: string | null | undefined,
  onNotification?: () => void,
  enabled: boolean = true
) {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!userId || !enabled) {
      setIsConnected(false);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    let channel: RealtimeChannel | null = null;

    const setupRealtimeSubscription = async () => {
      try {
        // Subscribe to INSERT and UPDATE events on Notification table for this user
        channel = supabase
          .channel(`notifications:${userId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'Notification',
              filter: `userId=eq.${userId}`,
            },
            (payload: any) => {
              console.log('[Realtime] Notification change:', payload);
              onNotification?.();
            }
          )
          .subscribe((status: string) => {
            console.log('[Realtime] Subscription status:', status);
            setIsConnected(status === 'SUBSCRIBED');
          });
      } catch (error) {
        console.error('[Realtime] Subscription error:', error);
        setIsConnected(false);
      }
    };

    setupRealtimeSubscription();

    // Cleanup subscription on unmount or when userId changes
    return () => {
      if (channel) {
        console.log('[Realtime] Cleaning up subscription');
        supabase.removeChannel(channel);
        setIsConnected(false);
      }
    };
  }, [userId, onNotification, enabled]);

  return { isConnected };
}

