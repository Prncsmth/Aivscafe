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

/** Grouped by what the owner/cashier is trying to do. The POS has its own big button above these. */
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Today',
    items: [
      { href: '/dashboard/', label: 'Dashboard', icon: 'dashboard', roles: ['OWNER', 'CASHIER'], hint: 'Today at a glance' },
      { href: '/orders/', label: 'Orders', icon: 'orders', roles: ['OWNER', 'CASHIER'], hint: 'Sales and order history' },
      { href: '/shift/', label: 'Cash Drawer', icon: 'wallet', roles: ['OWNER', 'CASHIER'], hint: 'Open and close the cash drawer' },
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
      { href: '/settings/', label: 'Settings', icon: 'settings', roles: ['OWNER'], hint: 'Shop rules' },
      { href: '/audit/', label: 'Audit Log', icon: 'shield', roles: ['OWNER'], hint: 'Who changed what' },
    ],
  },
];

export function ConnectionBadge() {
  const { online, unsyncedCount, syncing } = usePos();
  return (
    <div className="flex items-center gap-2" title="Connection status">
      <span
        className={cx(
          'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
          online ? 'bg-ok/10 text-ok' : 'bg-warn/15 text-warn',
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
    </div>
  );
}

/** The one thing staff use most: a big, unmistakable POS button. */
function PosButton({ active, onNavigate }: { active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href="/pos/"
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'group relative flex items-center gap-3 overflow-hidden rounded-2xl px-4 py-3.5 text-white shadow-[0_10px_24px_-10px_rgb(194_24_91/0.7)] transition',
        'bg-gradient-to-br from-[#f0478f] via-brand-strong to-brand hover:brightness-105 active:scale-[0.98]',
        active && 'ring-2 ring-brand ring-offset-2 ring-offset-[#f2f2f7]',
      )}
    >
      <span className="pointer-events-none absolute -top-8 -right-6 h-24 w-24 rounded-full bg-white/15" />
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
        <Icon name="pos" className="h-6 w-6" />
      </span>
      <span className="min-w-0">
        <span className="block text-lg leading-tight font-bold tracking-tight">POS</span>
        <span className="block text-xs text-white/85">Start a sale</span>
      </span>
      <Icon name="arrowRight" className="ml-auto h-5 w-5 opacity-80 transition group-hover:translate-x-0.5" />
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
          <div key={g.title} className="mb-4">
            <p className="mb-1 px-3 text-[11px] font-semibold text-[#8e8e93] uppercase">{g.title}</p>
            {/* iOS grouped list */}
            <div className="overflow-hidden rounded-xl bg-white/80 shadow-[0_0_0_0.5px_rgb(0_0_0/0.08)]">
              {items.map((n, i) => {
                const on = active(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={onNavigate}
                    title={n.hint}
                    aria-current={on ? 'page' : undefined}
                    className={cx('relative flex items-center gap-3 px-2.5 py-2 text-[14px] transition', on ? 'bg-brand text-white' : 'text-ink hover:bg-black/[0.04]')}
                  >
                    <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center', on ? 'text-white' : 'text-[#6e6e73]')}>
                      <Icon name={n.icon} className="h-[18px] w-[18px]" />
                    </span>
                    <span className={cx('flex-1 truncate', on ? 'font-semibold' : 'font-medium')}>{walkInOnly && n.href === '/orders/' ? 'Sales' : n.label}</span>
                    {/* hairline separator like iOS lists, inset past the icon */}
                    {i < items.length - 1 && !on && <span className="absolute right-0 bottom-0 left-[46px] h-px bg-black/[0.06]" />}
                  </Link>
                );
              })}
            </div>
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
  const tabs: { href: string; label: string; icon: IconName }[] = [
    { href: '/dashboard/', label: 'Home', icon: 'dashboard' },
    { href: '/orders/', label: walkInOnly ? 'Sales' : 'Orders', icon: 'orders' },
    { href: '/shift/', label: 'Drawer', icon: 'wallet' },
    { href: '/inventory/', label: 'Stock', icon: 'box' },
  ];

  const sidebarBody = (onNavigate?: () => void) => (
    <>
      <div className="px-3 pb-4">
        <PosButton active={!!isPos} onNavigate={onNavigate} />
      </div>
      <nav className="scrollbar-thin flex-1 overflow-y-auto px-3" aria-label="Main">
        <NavLinks role={user.role} active={active} onNavigate={onNavigate} />
      </nav>
    </>
  );

  return (
    <div className="flex min-h-dvh">
      {/* Sidebar (desktop): macOS-style translucent source list */}
      <aside className="no-print sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col border-r border-black/[0.08] bg-[#f2f2f7]/85 backdrop-blur-2xl backdrop-saturate-150 lg:flex">
        <Link href="/dashboard/" className="flex items-center gap-3 px-5 pt-5 pb-4">
          <Logo size={38} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold tracking-tight">Aiv&apos;s Cafe</p>
            <p className="truncate text-xs text-[#8e8e93]">Brew Blend &amp; Takoyaki</p>
          </div>
        </Link>
        {sidebarBody()}
        <div className="m-3 flex items-center gap-3 rounded-xl bg-white/80 px-3 py-2.5 shadow-[0_0_0_0.5px_rgb(0_0_0/0.08)]">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#f0478f] to-brand font-semibold text-white">{user.name.charAt(0).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="text-xs text-[#8e8e93]">{user.role === 'OWNER' ? 'Owner' : 'Cashier'}</p>
          </div>
          <button onClick={doLogout} className="rounded-lg p-2 text-[#8e8e93] hover:bg-black/[0.05] hover:text-ink" title="Log out" aria-label="Log out">
            <Icon name="logout" />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar: translucent like a macOS toolbar */}
        <header className="no-print sticky top-0 z-30 flex h-[60px] items-center gap-3 border-b border-black/[0.06] bg-white/75 px-4 backdrop-blur-xl backdrop-saturate-150 md:px-6">
          <button className="rounded-lg p-2 text-muted hover:bg-black/[0.05] lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Icon name="hamburger" />
          </button>
          <Link href="/dashboard/" className="flex items-center gap-2 lg:hidden">
            <Logo size={30} />
            <span className="font-bold tracking-tight">Aiv&apos;s Cafe</span>
          </Link>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {offlineSession && <Badge tone="warn">Offline sign-in · POS only</Badge>}
            <Link href="/shift/" title="Cash Drawer">
              <Badge tone={hasShift ? 'ok' : 'bad'}>{hasShift ? 'Drawer open' : 'Drawer closed'}</Badge>
            </Link>
            <ConnectionBadge />
          </div>
        </header>

        <main className={cx('flex-1 pb-28 lg:pb-8', isPos ? 'p-0' : 'mx-auto w-full max-w-[1400px] px-4 py-6 md:px-8')}>{children}</main>

        {/* iOS tab bar (phone / tablet) with a raised POS button in the middle */}
        <nav
          className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-black/[0.08] bg-white/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 lg:hidden"
          aria-label="Quick"
        >
          <div className="relative grid grid-cols-5 items-end">
            {[tabs[0], tabs[1], null, tabs[2], tabs[3]].map((t, i) =>
              t ? (
                <Link key={t.href} href={t.href} className={cx('flex flex-col items-center gap-0.5 pt-2 pb-2 text-[11px] font-medium', active(t.href) ? 'text-brand' : 'text-[#8e8e93]')}>
                  <Icon name={t.icon} className="h-6 w-6" />
                  {t.label}
                </Link>
              ) : (
                <div key={`pos-${i}`} className="flex justify-center">
                  <Link
                    href="/pos/"
                    aria-label="POS"
                    className={cx(
                      '-mt-6 flex h-16 w-16 flex-col items-center justify-center rounded-full bg-gradient-to-br from-[#f0478f] to-brand text-white shadow-[0_10px_24px_-6px_rgb(194_24_91/0.75)] ring-4 ring-white transition active:scale-95',
                    )}
                  >
                    <Icon name="pos" className="h-6 w-6" />
                    <span className="text-[10px] font-bold">POS</span>
                  </Link>
                </div>
              ),
            )}
          </div>
        </nav>
      </div>

      {/* Drawer (mobile) */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[280px] animate-rise flex-col bg-[#f2f2f7] shadow-2xl">
            <div className="flex items-center gap-3 px-5 pt-5 pb-4">
              <Logo size={36} />
              <p className="flex-1 font-bold tracking-tight">Aiv&apos;s Cafe</p>
              <button onClick={() => setMenuOpen(false)} className="rounded-lg p-2 text-[#8e8e93] hover:bg-black/[0.05]" aria-label="Close menu">
                <Icon name="close" />
              </button>
            </div>
            {sidebarBody(() => setMenuOpen(false))}
            <div className="p-3">
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
