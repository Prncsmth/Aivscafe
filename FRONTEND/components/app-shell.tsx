'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { usePos } from '@/lib/offline/pos-context';
import type { Role } from '@/lib/types';
import { Icon, type IconName } from './icons';
import { Logo } from './logo';
import { Badge, Button, Spinner, cx } from './ui';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  roles: Role[];
  hint: string;
}

/** Grouped by what the owner/cashier is trying to do. */
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Daily operations',
    items: [
      { href: '/dashboard/', label: 'Dashboard', icon: 'dashboard', roles: ['OWNER', 'CASHIER'], hint: 'Today at a glance' },
      { href: '/pos/', label: 'POS', icon: 'pos', roles: ['OWNER', 'CASHIER'], hint: 'Take orders and payments' },
      { href: '/orders/', label: 'Orders', icon: 'orders', roles: ['OWNER', 'CASHIER'], hint: 'Queue, status and history' },
      { href: '/shift/', label: 'Shift & Cash', icon: 'wallet', roles: ['OWNER', 'CASHIER'], hint: 'Open/close the cash drawer' },
      { href: '/sync/', label: 'Offline Sync', icon: 'sync', roles: ['OWNER', 'CASHIER'], hint: 'Orders saved without internet' },
    ],
  },
  {
    title: 'Stock',
    items: [
      { href: '/inventory/', label: 'Inventory', icon: 'box', roles: ['OWNER', 'CASHIER'], hint: 'Stock levels, waste, expiry' },
      { href: '/purchases/', label: 'Purchases', icon: 'truck', roles: ['OWNER'], hint: 'Record restocks and suppliers' },
    ],
  },
  {
    title: 'Business',
    items: [
      { href: '/menu/', label: 'Menu & Prices', icon: 'menu', roles: ['OWNER'], hint: 'Products, sizes, recipes' },
      { href: '/expenses/', label: 'Expenses', icon: 'receipt', roles: ['OWNER'], hint: 'Rent, utilities, other costs' },
      { href: '/reports/', label: 'Reports', icon: 'chart', roles: ['OWNER'], hint: 'Sales and profit' },
    ],
  },
  {
    title: 'Admin',
    items: [
      { href: '/users/', label: 'Users', icon: 'users', roles: ['OWNER'], hint: 'Staff accounts' },
      { href: '/settings/', label: 'Settings', icon: 'settings', roles: ['OWNER'], hint: 'Shop rules, delivery areas' },
      { href: '/audit/', label: 'Audit Log', icon: 'shield', roles: ['OWNER'], hint: 'Who changed what' },
    ],
  },
];

const MOBILE_PRIMARY: { href: string; label: string; icon: IconName }[] = [
  { href: '/dashboard/', label: 'Home', icon: 'dashboard' },
  { href: '/pos/', label: 'POS', icon: 'pos' },
  { href: '/orders/', label: 'Orders', icon: 'orders' },
  { href: '/shift/', label: 'Shift', icon: 'wallet' },
];

export function ConnectionBadge() {
  const { online, unsyncedCount, syncing } = usePos();
  return (
    <Link href="/sync/" className="flex items-center gap-2" title="Connection and offline sync status">
      <span
        className={cx(
          'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
          online ? 'border-ok/25 bg-ok/10 text-ok' : 'border-warn/30 bg-warn/10 text-warn',
        )}
      >
        <span className={cx('h-2 w-2 rounded-full', online ? 'bg-ok' : 'bg-warn')} />
        {online ? 'Online' : 'Offline'}
      </span>
      {(unsyncedCount > 0 || syncing) && (
        <Badge tone={syncing ? 'lilac' : 'warn'}>
          {syncing ? <Spinner className="h-3 w-3" /> : null}
          {unsyncedCount} waiting to sync
        </Badge>
      )}
    </Link>
  );
}

function NavLinks({ role, active, onNavigate }: { role: Role; active: (href: string) => boolean; onNavigate?: () => void }) {
  const walkInOnly = usePos().settings?.walkInOnly ?? true;
  return (
    <>
      {NAV_GROUPS.map((g) => {
        const items = g.items.filter((n) => n.roles.includes(role));
        if (!items.length) return null;
        return (
          <div key={g.title} className="mb-5">
            <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-faint uppercase">{g.title}</p>
            {items.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={onNavigate}
                title={n.hint}
                aria-current={active(n.href) ? 'page' : undefined}
                className={cx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                  active(n.href) ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-subtle hover:text-ink',
                )}
              >
                <Icon name={n.icon} className="h-[18px] w-[18px] shrink-0" />
                {walkInOnly && n.href === '/orders/' ? 'Sales' : n.label}
              </Link>
            ))}
          </div>
        );
      })}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, status, logout, offlineSession } = useAuth();
  const { shift, settings } = usePos();
  const walkInOnly = settings?.walkInOnly ?? true;
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login/');
  }, [status, router]);
  useEffect(() => setMenuOpen(false), [pathname]);

  if (status !== 'authenticated' || !user) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-muted">
        <Spinner className="h-6 w-6 text-brand" />
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  const isPos = pathname?.startsWith('/pos');
  const active = (href: string) => pathname === href || pathname === href.slice(0, -1);
  const hasShift = !!shift && shift.userId === user.id;
  const doLogout = () => void logout().then(() => router.replace('/login/'));

  return (
    <div className="flex min-h-dvh">
      {/* Sidebar (desktop) */}
      <aside className="no-print sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <Link href="/dashboard/" className="flex items-center gap-3 px-5 pt-5 pb-6">
          <Logo size={40} />
          <div className="min-w-0">
            <p className="truncate font-heading font-bold">Aiv&apos;s Cafe</p>
            <p className="truncate text-xs text-muted">Brew Blend &amp; Takoyaki</p>
          </div>
        </Link>
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-3" aria-label="Main">
          <NavLinks role={user.role} active={active} />
        </nav>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 px-2 py-1">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand">{user.name.charAt(0).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              <p className="text-xs text-muted">{user.role === 'OWNER' ? 'Owner' : 'Cashier'}</p>
            </div>
            <button onClick={doLogout} className="rounded-lg p-2 text-muted hover:bg-subtle hover:text-ink" title="Log out" aria-label="Log out">
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="no-print sticky top-0 z-30 flex h-[60px] items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur md:px-6">
          <button className="rounded-lg p-2 text-muted hover:bg-subtle lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Icon name="hamburger" />
          </button>
          <Link href="/dashboard/" className="flex items-center gap-2 lg:hidden">
            <Logo size={30} />
            <span className="font-heading font-bold">Aiv&apos;s Cafe</span>
          </Link>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {offlineSession && <Badge tone="warn">Offline sign-in · POS only</Badge>}
            <Link href="/shift/" title="Shift & Cash">
              <Badge tone={hasShift ? 'ok' : 'bad'}>{hasShift ? 'Shift open' : 'No open shift'}</Badge>
            </Link>
            <ConnectionBadge />
          </div>
        </header>

        <main className={cx('flex-1 pb-24 lg:pb-8', isPos ? 'p-0' : 'mx-auto w-full max-w-[1400px] px-4 py-6 md:px-8')}>{children}</main>

        {/* Bottom nav (mobile / tablet) */}
        <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Quick">
          {MOBILE_PRIMARY.map((n) => (
            <Link key={n.href} href={n.href} className={cx('flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium', active(n.href) ? 'text-brand' : 'text-muted')}>
              <Icon name={n.icon} />
              {walkInOnly && n.href === '/orders/' ? 'Sales' : n.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* Drawer (mobile) */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-ink/40" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 animate-rise flex-col bg-surface shadow-xl">
            <div className="flex items-center gap-3 px-5 pt-5 pb-5">
              <Logo size={36} />
              <p className="flex-1 font-heading font-bold">Aiv&apos;s Cafe</p>
              <button onClick={() => setMenuOpen(false)} className="rounded-lg p-2 text-muted hover:bg-subtle" aria-label="Close menu">
                <Icon name="close" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3">
              <NavLinks role={user.role} active={active} onNavigate={() => setMenuOpen(false)} />
            </nav>
            <div className="border-t border-line p-3">
              <Button variant="secondary" className="w-full" onClick={doLogout}>
                <Icon name="logout" /> Log out ({user.name})
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Notice({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-subtle text-muted">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <p className="font-heading text-lg font-semibold">{title}</p>
      <div className="max-w-sm text-sm text-muted">{children}</div>
    </div>
  );
}

/** Wrap owner-only pages. The backend enforces the same rule; this only avoids showing a page that would be refused. */
export function OwnerOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'OWNER') {
    return (
      <Notice icon="shield" title="Owner access only">
        Ask the owner if you need this page.
      </Notice>
    );
  }
  return <>{children}</>;
}

export function NeedsOnline({ children }: { children: ReactNode }) {
  const { online } = usePos();
  if (!online) {
    return (
      <Notice icon="info" title="This page needs the internet">
        <p>You can keep selling on the POS while offline. Orders sync automatically when the connection returns.</p>
        <Link href="/pos/" className="mt-4 inline-block">
          <Button>Go to POS</Button>
        </Link>
      </Notice>
    );
  }
  return <>{children}</>;
}
