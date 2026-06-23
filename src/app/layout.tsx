import "./globals.css";
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Analytics } from '@vercel/analytics/react';

export const metadata: Metadata = { 
  title: 'Kinda Healthy API Resolution Engine',
  icons: {
    icon: '/logo-favico.svg',
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const cloudfrontHost = process.env.NEXT_PUBLIC_CLOUDFRONT_HOST;
  
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {cloudfrontHost && (
          <>
            <link rel="preconnect" href={`https://${cloudfrontHost}`} />
            <link rel="dns-prefetch" href={`https://${cloudfrontHost}`} />
          </>
        )}
        <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL || ''} crossOrigin="anonymous" />
        <link rel="dns-prefetch" href={process.env.NEXT_PUBLIC_SUPABASE_URL || ''} />
      </head>
      <body className="min-h-screen bg-background text-foreground">
        <main className="min-h-screen">{children}</main>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}

