import "./globals.css";
import type { ReactNode } from 'react';
import { AuthHeader } from '@/components/auth/AuthHeader';
import { WelcomeNotification } from '@/components/WelcomeNotification';
import { Suspense } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground">
        <AuthHeader />
        <main className="min-h-screen">{children}</main>
        <Suspense fallback={null}>
          <WelcomeNotification />
        </Suspense>
      </body>
    </html>
  );
}
