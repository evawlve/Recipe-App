"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

interface User {
  id: string;
  email: string;
  name?: string;
}

export function AuthHeader() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function getUser() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: { user: authUser }, error } = await supabase.auth.getUser();
        
        if (error || !authUser) {
          setUser(null);
        } else {
          setUser({
            id: authUser.id,
            email: authUser.email || '',
            name: authUser.user_metadata?.name || authUser.email || 'User',
          });
        }
      } catch (error) {
        console.error('Error getting user:', error);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    }

    getUser();

    // Listen for auth changes
    const supabase = createSupabaseBrowserClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email || '',
          name: session.user.user_metadata?.name || session.user.email || 'User',
        });
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      setUser(null);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <header className="border-b border-border">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-text hover:text-primary transition-colors">
            Recipe App
          </Link>
          <nav className="flex items-center gap-4">
            <Link 
              href="/recipes" 
              className="text-text hover:text-primary transition-colors"
            >
              Recipes
            </Link>
            
            {isLoading ? (
              <div className="animate-pulse bg-muted h-8 w-20 rounded"></div>
            ) : user ? (
              <div className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground">
                  {user.name || user.email}
                </span>
                <Button asChild>
                  <Link href="/recipes/new">New Recipe</Link>
                </Button>
                <Button variant="outline" onClick={handleSignOut}>
                  Sign Out
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <Button asChild>
                  <Link href="/recipes/new">New Recipe</Link>
                </Button>
                <Button asChild>
                  <Link href="/signin">Sign In</Link>
                </Button>
              </div>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
