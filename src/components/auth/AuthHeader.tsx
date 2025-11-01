"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { isTokenError } from '@/lib/auth-utils';
import { SearchBox } from '@/components/nav/SearchBox';
import Logo from '@/components/Logo';
import { Menu, X, Search, Bell } from 'lucide-react';
import NotificationBell from '@/components/NotificationBell';

interface User {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

export function AuthHeader() {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNavbarVisible, setIsNavbarVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  
  // Check if we're on signup page
  const isSignupPage = pathname === '/signup';

  // Smart sticky navbar scroll detection
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      // Show navbar when scrolling up or at the top
      if (currentScrollY < lastScrollY || currentScrollY < 10) {
        setIsNavbarVisible(true);
      } 
      // Hide navbar when scrolling down (but only after scrolling past 100px)
      else if (currentScrollY > lastScrollY && currentScrollY > 100) {
        setIsNavbarVisible(false);
      }
      
      setLastScrollY(currentScrollY);
    };

    // Only add scroll listener on client side
    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', handleScroll, { passive: true });
      return () => window.removeEventListener('scroll', handleScroll);
    }
  }, [lastScrollY]);

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
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: any, session: any) => {
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
    <header 
      className={`fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border transition-transform duration-300 ${
        isNavbarVisible ? 'translate-y-0' : '-translate-y-full'
      }`}
    >
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          {/* Left side - Logo and Navigation */}
          <div className="flex items-center gap-8">
            {isSignupPage ? (
              <div className="flex items-center gap-2 cursor-not-allowed opacity-50 relative group">
                <Logo size="md" />
                <span className="text-2xl font-bold text-foreground">Mealspire</span>
                {/* Tooltip */}
                <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                  Complete setup to access home
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                </div>
              </div>
            ) : (
              <Link href="/" className="flex items-center gap-2">
                <Logo size="md" />
                <span className="text-2xl font-bold text-foreground">Mealspire</span>
              </Link>
            )}
            
            {/* Navigation Links */}
            <nav className="hidden lg:flex items-center gap-6">
              {isSignupPage ? (
                // Disabled navigation during signup
                <>
                  <span className="text-muted-foreground/50 font-medium cursor-not-allowed">
                    Home
                  </span>
                  <span className="text-muted-foreground/50 font-medium cursor-not-allowed">
                    Explore
                  </span>
                  <span className="text-muted-foreground/50 font-medium cursor-not-allowed">
                    Create
                  </span>
                </>
              ) : (
                // Normal navigation
                <>
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
                </>
              )}
            </nav>
          </div>

          {/* Right side - Search, Notifications, Avatar */}
          <div className="flex items-center gap-4">
            {/* Search Bar */}
            <div className="hidden lg:block">
              {isSignupPage ? (
                <div className="relative">
                  <div className="w-64 h-10 bg-muted/50 border border-border/50 rounded-lg flex items-center px-3 text-muted-foreground/50 cursor-not-allowed">
                    <Search className="h-4 w-4 mr-2" />
                    <span className="text-sm">Complete setup to search...</span>
                  </div>
                </div>
              ) : (
                <SearchBox />
              )}
            </div>

            {/* Notifications Button */}
            {isSignupPage ? (
              <div className="hidden lg:flex h-10 w-10 p-0 bg-muted/50 rounded-lg cursor-not-allowed opacity-50 relative group items-center justify-center">
                <Bell className="h-4 w-4 text-muted-foreground/50" />
                {/* Tooltip */}
                <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                  Complete setup to access notifications
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                </div>
              </div>
            ) : user ? (
              <div className="hidden lg:flex">
                <NotificationBell />
              </div>
            ) : null}

            {/* User Avatar or Sign In */}
            {isLoading ? (
              <div className="animate-pulse bg-muted h-10 w-10 rounded-full"></div>
            ) : user ? (
              isSignupPage ? (
                // Disabled avatar during signup
                <div className="flex items-center cursor-not-allowed opacity-50">
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
                </div>
              ) : (
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
              )
            ) : (
              <Button asChild className="bg-primary hover:bg-primary/90 text-primary-foreground">
                <Link href="/signin">Sign In</Link>
              </Button>
            )}

            {/* Mobile Menu Button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="lg:hidden p-2 rounded-md hover:bg-muted transition-colors"
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
          <div className="lg:hidden mt-4 pb-4 border-t border-border pt-4">
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
              <div className="mt-4">
                {isSignupPage ? (
                  <div className="w-full h-10 bg-muted/50 border border-border/50 rounded-lg flex items-center px-3 text-muted-foreground/50 cursor-not-allowed">
                    <Search className="h-4 w-4 mr-2" />
                    <span className="text-sm">Complete setup to search...</span>
                  </div>
                ) : (
                  <SearchBox className="w-full" />
                )}
              </div>
              
              {/* Mobile Notifications */}
              {user && !isSignupPage && (
                <div className="mt-4">
                  <NotificationBell />
                </div>
              )}
              
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
