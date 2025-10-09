"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Menu, X } from 'lucide-react';

interface User {
  id: string;
  email: string;
  name?: string;
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

    // Only run on client side
    if (typeof window !== 'undefined') {
      getUser();

      // Listen for auth changes
      try {
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
      setUser(null);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <header className="border-b border-border">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-1 text-3xl font-bold text-text hover:text-primary transition-colors">
            <div className="h-14 w-14 overflow-hidden flex items-center justify-center">
              <Image 
                src="/logo-noLetters.svg" 
                alt="Mealspire Logo" 
                width={180} 
                height={180} 
                className="h-36 w-36 object-contain translate-y-1"
              />
            </div>
            <span>Mealspire</span>
          </Link>
          
          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-4">
            <Button asChild className="bg-green-600 hover:bg-green-700 text-white">
              <Link href="/recipes">Recipes</Link>
            </Button>
            
            {user && (
              <Button asChild variant="outline">
                <Link href="/saved">Saved</Link>
              </Button>
            )}
            
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
                <Button asChild className="bg-green-600 hover:bg-green-700 text-white">
                  <Link href="/signin">Sign In</Link>
                </Button>
              </div>
            )}
          </nav>

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

        {/* Mobile Navigation */}
        {isMobileMenuOpen && (
          <div className="md:hidden mt-4 pb-4 border-t border-border pt-4">
            <nav className="flex flex-col space-y-4">
              <Button asChild className="w-full bg-green-600 hover:bg-green-700 text-white">
                <Link href="/recipes" onClick={() => setIsMobileMenuOpen(false)}>Recipes</Link>
              </Button>
              
              {user && (
                <Button asChild variant="outline" className="w-full">
                  <Link href="/saved" onClick={() => setIsMobileMenuOpen(false)}>Saved</Link>
                </Button>
              )}
              
              {isLoading ? (
                <div className="animate-pulse bg-muted h-8 w-20 rounded"></div>
              ) : user ? (
                <div className="flex flex-col space-y-4">
                  <span className="text-sm text-muted-foreground py-2">
                    {user.name || user.email}
                  </span>
                  <Button asChild className="w-full">
                    <Link href="/recipes/new" onClick={() => setIsMobileMenuOpen(false)}>New Recipe</Link>
                  </Button>
                  <Button variant="outline" onClick={handleSignOut} className="w-full">
                    Sign Out
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col space-y-4">
                  <Button asChild className="w-full bg-green-600 hover:bg-green-700 text-white">
                    <Link href="/signin" onClick={() => setIsMobileMenuOpen(false)}>Sign In</Link>
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
