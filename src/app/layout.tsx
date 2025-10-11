import "./globals.css";
import type { ReactNode } from 'react';
import { AuthHeader } from '@/components/auth/AuthHeader';
import { WelcomeNotification } from '@/components/WelcomeNotification';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SignupGuard } from '@/components/SignupGuard';
import ThemeScript from '@/components/ThemeScript';
import { Suspense } from 'react';
import { ThemeProvider } from 'next-themes';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <ErrorBoundary>
            <SignupGuard>
              <Suspense fallback={<div className="border-b border-border"><div className="container mx-auto px-4 py-4"><div className="animate-pulse bg-muted h-8 w-32 rounded"></div></div></div>}>
                <AuthHeader />
              </Suspense>
              <main className="min-h-screen pt-20">{children}</main>
              <Suspense fallback={null}>
                <WelcomeNotification />
              </Suspense>
            </SignupGuard>
          </ErrorBoundary>
        </ThemeProvider>
      </body>
    </html>
  );
}
