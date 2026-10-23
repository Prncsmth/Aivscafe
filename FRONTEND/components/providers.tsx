'use client';

import { useEffect, type ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { PosProvider } from '@/lib/offline/pos-context';
import { ToastProvider } from './toast';

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    // The service worker caches the app shell so the POS opens offline (production builds only).
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Service worker registration failed', e));
    }
  }, []);
  return (
    <AuthProvider>
      <PosProvider>
        <ToastProvider>{children}</ToastProvider>
      </PosProvider>
    </AuthProvider>
  );
}
