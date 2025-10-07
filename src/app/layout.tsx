import "./globals.css";
import type { ReactNode } from 'react';
import { AuthHeader } from '@/components/auth/AuthHeader';
import { WelcomeNotification } from '@/components/WelcomeNotification';
import { Suspense } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground">
        <Suspense fallback={<div className="border-b border-border"><div className="container mx-auto px-4 py-4"><div className="animate-pulse bg-muted h-8 w-32 rounded"></div></div></div>}>
          <AuthHeader />
        </Suspense>
        <main className="min-h-screen">{children}</main>
        <Suspense fallback={null}>
          <WelcomeNotification />
        </Suspense>
      </body>
    </html>
  );
}
