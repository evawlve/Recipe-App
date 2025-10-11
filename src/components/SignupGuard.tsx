"use client";

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

interface SignupGuardProps {
  children: React.ReactNode;
}

export function SignupGuard({ children }: SignupGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isChecking, setIsChecking] = useState(true);
  const [isAllowed, setIsAllowed] = useState(false);

  useEffect(() => {
    const checkSignupStatus = async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          // Not authenticated, allow access to public pages
          setIsAllowed(true);
          setIsChecking(false);
          return;
        }

        // Check if user has completed profile setup (has username)
        const response = await fetch('/api/whoami');
        if (response.ok) {
          const userData = await response.json();
          console.log('SignupGuard: User data from whoami:', userData);
          
          if (userData.username) {
            // User has completed signup, allow access
            console.log('SignupGuard: User has username, allowing access');
            setIsAllowed(true);
          } else {
            // User is authenticated but hasn't completed signup
            console.log('SignupGuard: User missing username, redirecting to signup');
            router.push('/signup?verified=true&email=' + encodeURIComponent(user.email || ''));
            return;
          }
        } else {
          // API error, redirect to signup
          router.push('/signup?verified=true&email=' + encodeURIComponent(user.email || ''));
          return;
        }
      } catch (error) {
        console.error('Error checking signup status:', error);
        // On error, redirect to signup
        router.push('/signup');
        return;
      } finally {
        setIsChecking(false);
      }
    };

    // Only check on non-signup pages
    if (pathname !== '/signup' && pathname !== '/signin' && pathname !== '/forgot-password') {
      checkSignupStatus();
    } else {
      setIsAllowed(true);
      setIsChecking(false);
    }
  }, [pathname, router]);

  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!isAllowed) {
    return null; // Will redirect
  }

  return <>{children}</>;
}
