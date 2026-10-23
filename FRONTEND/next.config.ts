import type { NextConfig } from 'next';

if (!process.env.NEXT_PUBLIC_API_URL) {
  const msg = 'NEXT_PUBLIC_API_URL is not set. Copy .env.example to .env and set the backend API URL.';
  // A production build without an API URL would ship a broken app, so it fails; dev only warns.
  if (process.env.NODE_ENV === 'production') throw new Error(msg);
  console.warn(`⚠ ${msg}`);
}

/**
 * Static export: the whole UI is plain files that a service worker can cache,
 * so the POS opens and works with no internet connection.
 * All data comes from the separate Express API (NEXT_PUBLIC_API_URL).
 */
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
