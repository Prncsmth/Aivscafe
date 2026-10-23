'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cx } from './ui';

type ToastTone = 'ok' | 'bad' | 'info' | 'warn';
interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 7000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="no-print pointer-events-none fixed inset-x-0 top-[68px] z-[60] flex flex-col items-center gap-2 px-4 md:items-end md:pr-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto max-w-md animate-pop rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg',
              t.tone === 'ok' && 'border-ok/30 bg-surface text-ok',
              t.tone === 'bad' && 'border-bad/30 bg-surface text-bad',
              t.tone === 'warn' && 'border-warn/30 bg-surface text-warn',
              t.tone === 'info' && 'border-brand/30 bg-surface text-brand',
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
