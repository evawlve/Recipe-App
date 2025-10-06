import "./globals.css";
import type { ReactNode } from 'react';
import { AuthHeader } from '@/components/auth/AuthHeader';
import { WelcomeNotification } from '@/components/WelcomeNotification';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground">
        <AuthHeader />
        <main className="min-h-screen">{children}</main>
        <WelcomeNotification />
      </body>
    </html>
  );
}
