import "./globals.css";
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Nunito } from 'next/font/google';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Analytics } from '@vercel/analytics/react';
import ThemeScript from '@/components/ThemeScript';
import { SiteFooter } from '@/components/SiteFooter';
import { ThemeProvider } from 'next-themes';

// Rounded, chunky typeface to match the mobile app's playful design language.
const nunito = Nunito({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800', '900'],
  variable: '--font-nunito',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Mealspire',
  description:
    'Mealspire is a mobile nutrition app in development: natural-language food logging, barcode scanning, and nutrition data you can trust.',
  icons: {
    icon: '/logo-favico.svg',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={nunito.variable}>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <main className="min-h-screen">{children}</main>
          <SiteFooter />
        </ThemeProvider>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
