'use client';

import { useEffect } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function ClearAuthPage() {
  const router = useRouter();

  useEffect(() => {
    const clearAuth = async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        await supabase.auth.signOut();
        
        // Clear all storage
        localStorage.clear();
        sessionStorage.clear();
        
        console.log('Auth cleared successfully');
        
        // Redirect to home
        router.push('/');
      } catch (error) {
        console.error('Error clearing auth:', error);
        // Still redirect even if there's an error
        router.push('/');
      }
    };

    clearAuth();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Clearing Authentication...</h1>
        <p className="text-muted-foreground">Redirecting to home page...</p>
      </div>
    </div>
  );
}