"use client";

import { useEffect } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function ClearAuthPage() {
  useEffect(() => {
    // Auto-clear auth on page load
    const clearAuth = async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        await supabase.auth.signOut();
        
        // Clear local storage
        if (typeof window !== 'undefined') {
          localStorage.clear();
          sessionStorage.clear();
        }
        
        // Redirect after a short delay
        setTimeout(() => {
          window.location.href = '/signin';
        }, 2000);
      } catch (error) {
        console.error('Error clearing auth:', error);
      }
    };
    
    clearAuth();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-6 text-center">
        <h2 className="text-xl font-semibold mb-4">Clearing Authentication</h2>
        <p className="text-muted-foreground mb-4">
          Please wait while we clear your authentication data...
        </p>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
        <p className="text-sm text-muted-foreground mt-4">
          You will be redirected to the sign-in page shortly.
        </p>
      </Card>
    </div>
  );
}
