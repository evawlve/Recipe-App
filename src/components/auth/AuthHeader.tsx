"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { isTokenError } from '@/lib/auth-utils';
import Logo from '@/components/Logo';
import { Menu, X, Search, Bell } from 'lucide-react';

interface User {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

export function AuthHeader() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    async function getUser() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: { user: authUser }, error } = await supabase.auth.getUser();
        
        if (error) {
          // Handle specific auth errors
          if (isTokenError(error) || error.message?.includes('Auth session missing')) {
            // Clear invalid session and redirect
            await supabase.auth.signOut();
            setUser(null);
          } else {
            console.error('Auth error:', error);
            setUser(null);
          }
        } else if (!authUser) {
          setUser(null);
        } else {
          // Fetch user data from our database to get the latest name
          try {
            const response = await fetch('/api/whoami');
            if (response.ok) {
              const userData = await response.json();
              setUser({
                id: userData.id,
                email: userData.email,
                name: userData.name,
                avatarUrl: userData.avatarUrl,
              });
            } else {
              // Fallback to Supabase metadata if API fails
              setUser({
                id: authUser.id,
                email: authUser.email || '',
                name: authUser.user_metadata?.name || authUser.email || 'User',
              });
            }
          } catch (apiError) {
            console.error('Error fetching user from API:', apiError);
            // Fallback to Supabase metadata
            setUser({
              id: authUser.id,
              email: authUser.email || '',
              name: authUser.user_metadata?.name || authUser.email || 'User',
            });
          }
        }
      } catch (error) {
        console.error('Error getting user:', error);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    }

    // Only run on client side
    if (typeof window !== 'undefined') {
      // Check if we're already on a public page to avoid unnecessary auth checks
      const isPublicPage = window.location.pathname === '/signin' || 
                          window.location.pathname === '/signup' || 
                          window.location.pathname === '/forgot-password';
      
      if (!isPublicPage) {
        getUser();
      } else {
        setIsLoading(false);
      }

      // Listen for auth changes
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          try {
            if (event === 'SIGNED_OUT' || !session?.user) {
              setUser(null);
            } else if (session?.user) {
              // Fetch user data from our database to get the latest name
              try {
                const response = await fetch('/api/whoami');
                if (response.ok) {
                  const userData = await response.json();
                  setUser({
                    id: userData.id,
                    email: userData.email,
                    name: userData.name,
                    avatarUrl: userData.avatarUrl,
                  });
                } else {
                  // Fallback to Supabase metadata if API fails
                  setUser({
                    id: session.user.id,
                    email: session.user.email || '',
                    name: session.user.user_metadata?.name || session.user.email || 'User',
                  });
                }
              } catch (apiError) {
                console.error('Error fetching user from API:', apiError);
                // Fallback to Supabase metadata
                setUser({
                  id: session.user.id,
                  email: session.user.email || '',
                  name: session.user.user_metadata?.name || session.user.email || 'User',
                });
              }
            }
          } catch (authError) {
            console.error('Auth state change error:', authError);
            setUser(null);
          }
        });

        return () => subscription.unsubscribe();
      } catch (error) {
        console.error('Error setting up auth listener:', error);
        setIsLoading(false);
      }
    } else {
      setIsLoading(false);
    }
  }, []);

  const handleSignOut = async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      // Force redirect to sign in page
      window.location.href = '/signin';
    } catch (error) {
      console.error('Error signing out:', error);
      // Still redirect even if there's an error
      window.location.href = '/signin';
    }
  };

  return (
    <header className="bg-background border-b border-border">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          {/* Left side - Logo and Navigation */}
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2">
              <Logo size="md" />
              <span className="text-2xl font-bold text-foreground">Mealspire</span>
            </Link>
            
            {/* Navigation Links */}
            <nav className="hidden md:flex items-center gap-6">
              <Link 
                href="/" 
                className="text-muted-foreground hover:text-foreground font-medium transition-colors"
              >
                Home
              </Link>
              <Link 
                href="/recipes" 
                className="text-muted-foreground hover:text-foreground font-medium transition-colors"
              >
                Explore
              </Link>
              <Link 
                href="/recipes/new" 
                className="text-muted-foreground hover:text-foreground font-medium transition-colors"
              >
                Create
              </Link>
            </nav>
          </div>

          {/* Right side - Search, Notifications, Avatar */}
          <div className="flex items-center gap-4">
            {/* Search Bar */}
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                type="text"
                placeholder="Search"
                className="pl-10 pr-4 py-2 w-64 bg-muted border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>

            {/* Notifications Button */}
            <Button
              variant="ghost"
              size="sm"
              className="hidden md:flex h-10 w-10 p-0 bg-muted hover:bg-muted/80 rounded-lg"
            >
              <Bell className="h-4 w-4 text-muted-foreground" />
            </Button>

            {/* User Avatar or Sign In */}
            {isLoading ? (
              <div className="animate-pulse bg-muted h-10 w-10 rounded-full"></div>
            ) : user ? (
              <Link href="/me" className="flex items-center">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.name || user.email}
                    className="h-10 w-10 rounded-full object-cover border-2 border-border"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                    <span className="text-sm font-medium text-muted-foreground">
                      {(user.name || user.email)[0].toUpperCase()}
                    </span>
                  </div>
                )}
              </Link>
            ) : (
              <Button asChild className="bg-primary hover:bg-primary/90 text-primary-foreground">
                <Link href="/signin">Sign In</Link>
              </Button>
            )}

            {/* Mobile Menu Button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 rounded-md hover:bg-muted transition-colors"
              aria-label="Toggle mobile menu"
            >
              {isMobileMenuOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {isMobileMenuOpen && (
          <div className="md:hidden mt-4 pb-4 border-t border-border pt-4">
            <nav className="flex flex-col space-y-4">
              <Link 
                href="/" 
                className="text-muted-foreground hover:text-foreground font-medium py-2"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Home
              </Link>
              <Link 
                href="/recipes" 
                className="text-muted-foreground hover:text-foreground font-medium py-2"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Explore
              </Link>
              <Link 
                href="/recipes/new" 
                className="text-muted-foreground hover:text-foreground font-medium py-2"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Create
              </Link>
              
              {/* Mobile Search */}
              <div className="relative mt-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  type="text"
                  placeholder="Search"
                  className="pl-10 pr-4 py-2 w-full bg-muted border-border rounded-lg"
                />
              </div>
              
              {user && (
                <div className="flex flex-col space-y-4 pt-4 border-t border-border">
                  <Button variant="outline" onClick={handleSignOut} className="w-full">
                    Sign Out
                  </Button>
                </div>
              )}
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
