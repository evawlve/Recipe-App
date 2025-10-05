import "./globals.css";
import type { ReactNode } from 'react';
import { AuthHeader } from '@/components/auth/AuthHeader';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-text">
        <AuthHeader />
        <main className="min-h-screen">{children}</main>
      </body>
    </html>
  );
}
