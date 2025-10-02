import "./globals.css";
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-text">
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
                <Button asChild>
                  <Link href="/recipes/new">New Recipe</Link>
                </Button>
              </nav>
            </div>
          </div>
        </header>
        <main className="min-h-screen">{children}</main>
      </body>
    </html>
  );
}
