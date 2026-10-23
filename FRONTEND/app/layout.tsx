import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

// Downloaded at build time and self-hosted, so it also works offline.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: "Aiv's Cafe",
  description: 'POS, inventory, cash drawer and sales for Yummy Brew Blend & Takoyaki Delight by Aiv’s Cafe',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/favicon.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: "Aiv's POS", statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
