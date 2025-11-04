import "./globals.css";
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Analytics } from '@vercel/analytics/react';
import { AuthHeader } from '@/components/auth/AuthHeader';
import { WelcomeNotification } from '@/components/WelcomeNotification';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SignupGuard } from '@/components/SignupGuard';
import ThemeScript from '@/components/ThemeScript';
import { Suspense } from 'react';
import { ThemeProvider } from 'next-themes';

export const metadata: Metadata = { 
  title: 'Mealspire',
  icons: {
    icon: '/logo-favico.svg',
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Get CloudFront host for preconnect optimization
  const cloudfrontHost = process.env.NEXT_PUBLIC_CLOUDFRONT_HOST;
  
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
        {cloudfrontHost && (
          <>
            <link rel="preconnect" href={`https://${cloudfrontHost}`} />
            <link rel="dns-prefetch" href={`https://${cloudfrontHost}`} />
          </>
        )}
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
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
