'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePos } from '@/lib/offline/pos-context';
import { peso } from '@/lib/money';
import { PAY_LABEL, PAY_TONE, STATUS_LABEL, STATUS_TONE, fmtDate, fmtDateTime, manilaDay, minutesAgo, qty } from '@/lib/format';
import type { Order, ShiftSummary } from '@/lib/types';
import { Badge, Button, Card, EmptyState, ErrorNote, Skeleton, Stat, cx } from '@/components/ui';
import { BarChart, RankBars } from '@/components/bar-chart';
import { Icon } from '@/components/icons';
import { OrderDetailModal } from '@/components/order-detail';

interface LowStock {
  id: string;
  name: string;
  baseUnit: string;
  stockQty: string;
  lowStockThreshold: string;
  level: 'LOW' | 'OUT';
}
interface Expiring {
  id: string;
  ingredientName: string;
  baseUnit: string;
  remainingQty: string;
  expiryDate: string;
  expired: boolean;
}
interface OwnerDash {
  today: {
    orderCount: number;
    netSalesCentavos: number;
    deliveryFeesCentavos: number;
    averageOrderValueCentavos: number;
    grossProfitCentavos: number;
    cogsCentavos: number;
    cancelledOrVoidedCount: number;
    offlineOrderCount: number;
  };
  warnings: string[];
  bestSellersToday: { name: string; quantity: number; revenueCentavos: number }[];
  trend: { day: string; orders: number; revenueCentavos: number }[];
  lowStock: LowStock[];
  expiring: Expiring[];
  recentOrders: Order[];
  openConflicts: number;
  pendingShiftReviews: number;
  unverifiedGcash: { count: number; amountCentavos: number };
}
interface CashierDash {
  shift: ShiftSummary | null;
  queue: Order[];
  recentOrders: Order[];
  lowStock: LowStock[];
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { online } = usePos();
  return (
    <>
      <Hero name={user?.name ?? ''} />
      {!online ? (
        <EmptyState title="You are offline">
          The dashboard needs the internet. Keep selling on the{' '}
          <Link className="text-brand underline" href="/pos/">
            POS
          </Link>{' '}
          — orders will sync when you are back online.
        </EmptyState>
      ) : user?.role === 'OWNER' ? (
        <OwnerDashboard />
      ) : (
        <CashierDashboard />
      )}
    </>
  );
}

function Hero({ name }: { name: string }) {
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', hourCycle: 'h23' }));
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <div className="mb-6 animate-rise">
      <p className="text-sm text-muted">{fmtDate(new Date())}</p>
      <h1 className="mt-0.5 text-2xl font-bold md:text-3xl">
        {greet}, {name.split(' ')[0]}
      </h1>
    </div>
  );
}

const SETUP_STEPS: { id: string; title: string; text: string; href: string; action: string }[] = [
  { id: 'passwords', title: 'Change the demo passwords', text: 'Set your own password and create real cashier accounts.', href: '/users/', action: 'Open Users' },
  { id: 'prices', title: 'Set your real menu and prices', text: 'Edit or archive the demo products so the POS shows your actual menu.', href: '/menu/', action: 'Open Menu & Prices' },
  { id: 'recipes', title: 'Add a recipe to each size', text: 'Recipes let the system deduct stock and calculate profit automatically.', href: '/menu/', action: 'Edit recipes' },
  { id: 'stock', title: 'Record your current stock', text: 'Enter what you bought (with cost and expiry) on the Purchases page.', href: '/purchases/', action: 'Record purchase' },
  { id: 'delivery', title: 'Check delivery areas and fees', text: 'Set the fees for Cordova, Lapu-Lapu and any other area you deliver to.', href: '/settings/', action: 'Open Settings' },
];
const SETUP_KEY = 'sms.setupDone';

/** A short, dismissible setup guide so the owner knows what to do first. Progress is remembered on this device. */
function GettingStarted() {
  const [done, setDone] = useState<string[]>([]);
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SETUP_KEY) ?? '{}') as { done?: string[]; hidden?: boolean };
      setDone(saved.done ?? []);
      setHidden(!!saved.hidden);
    } catch {
      setHidden(false);
    }
  }, []);
  const save = (next: { done: string[]; hidden: boolean }) => {
    setDone(next.done);
    setHidden(next.hidden);
    try {
      localStorage.setItem(SETUP_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: progress is not remembered */
    }
  };
  if (hidden) return null;
  const toggle = (id: string) => save({ done: done.includes(id) ? done.filter((x) => x !== id) : [...done, id], hidden: false });
  return (
    <Card className="animate-rise p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Getting started</h2>
          <p className="text-sm text-muted">
            {done.length} of {SETUP_STEPS.length} done. Finish these once and the system takes care of the rest.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => save({ done, hidden: true })}>
          Hide guide
        </Button>
      </div>
      <div className="mb-4 h-1.5 rounded-full bg-subtle">
        <div className="h-1.5 rounded-full bg-brand transition-[width]" style={{ width: `${(done.length / SETUP_STEPS.length) * 100}%` }} />
      </div>
      <ol className="space-y-2">
        {SETUP_STEPS.map((s, i) => {
          const isDone = done.includes(s.id);
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
              <button
                onClick={() => toggle(s.id)}
                aria-label={isDone ? `Mark "${s.title}" as not done` : `Mark "${s.title}" as done`}
                className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold', isDone ? 'border-ok bg-ok text-white' : 'border-line text-muted')}
              >
                {isDone ? <Icon name="check" className="h-4 w-4" /> : i + 1}
              </button>
              <div className="min-w-0 flex-1">
                <p className={cx('font-semibold', isDone && 'text-muted line-through')}>{s.title}</p>
                <p className="text-sm text-muted">{s.text}</p>
              </div>
              <Link href={s.href}>
                <Button variant="secondary" size="sm">
                  {s.action}
                </Button>
              </Link>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function OwnerDashboard() {
  const [d, setD] = useState<OwnerDash | null>(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const load = () => api.get<OwnerDash>('/dashboard/owner').then(setD, (e) => setError(errorMessage(e)));
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!d) return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>;

  const today = manilaDay();
  return (
    <div className="space-y-6">
      <GettingStarted />
      {(d.openConflicts > 0 || d.pendingShiftReviews > 0 || d.unverifiedGcash.count > 0) && (
        <div className="flex flex-wrap gap-2">
          {d.openConflicts > 0 && (
            <Link href="/sync/">
              <Badge tone="warn">{d.openConflicts} sync conflict(s) to review</Badge>
            </Link>
          )}
          {d.pendingShiftReviews > 0 && (
            <Link href="/shift/">
              <Badge tone="bad">{d.pendingShiftReviews} cash drawer(s) with differences</Badge>
            </Link>
          )}
          {d.unverifiedGcash.count > 0 && (
            <Link href="/orders/">
              <Badge tone="lilac">
                {d.unverifiedGcash.count} GCash payment(s) unverified · {peso(d.unverifiedGcash.amountCentavos)}
              </Badge>
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Today's sales" value={peso(d.today.netSalesCentavos + d.today.deliveryFeesCentavos)} hint={d.today.deliveryFeesCentavos ? `incl. ${peso(d.today.deliveryFeesCentavos)} delivery` : 'after discounts'} />
        <Stat label="Orders" value={d.today.orderCount} hint={`${d.today.cancelledOrVoidedCount} cancelled · ${d.today.offlineOrderCount} offline`} delay={60} />
        <Stat label="Average order" value={peso(d.today.averageOrderValueCentavos)} delay={120} />
        <Stat label="Est. gross profit" value={peso(d.today.grossProfitCentavos)} hint={`Ingredient cost ${peso(d.today.cogsCentavos)}`} tone={d.today.grossProfitCentavos < 0 ? 'bad' : 'ok'} delay={180} />
      </div>
      {d.warnings.length > 0 && (
        <div className="rounded-2xl border border-warn/30 bg-warn/5 p-3 text-xs text-warn">
          <p className="font-bold">Profit figures are estimates:</p>
          <ul className="list-disc pl-5">
            {d.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="animate-rise p-5 xl:col-span-2">
          <h2 className="mb-1 text-xl font-bold">Sales, last 14 days</h2>
          <p className="mb-3 text-xs text-muted">Net sales + delivery fees per day (Manila time). Today is highlighted.</p>
          <BarChart
            ariaLabel="Daily sales for the last 14 days"
            data={d.trend.map((t) => ({ key: t.day, label: t.day.slice(5).replace('-', '/'), value: t.revenueCentavos, detail: `${t.orders} orders` }))}
            format={peso}
            highlightKey={today}
            labelEvery={2}
          />
        </Card>
        <Card className="animate-rise p-5 [animation-delay:80ms]">
          <h2 className="mb-3 text-xl font-bold">Best sellers today</h2>
          {d.bestSellersToday.length === 0 ? (
            <EmptyState title="No sales yet today" />
          ) : (
            <RankBars rows={d.bestSellersToday.map((b) => ({ name: b.name, value: b.quantity, sub: peso(b.revenueCentavos) }))} format={(v) => `${v} sold`} />
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <StockCard low={d.lowStock} />
        <Card className="animate-rise p-5">
          <h2 className="mb-3 text-xl font-bold">Expiring soon</h2>
          {d.expiring.length === 0 ? (
            <p className="text-sm text-muted">No batches close to expiry.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.expiring.slice(0, 8).map((b) => (
                <li key={b.id} className="flex justify-between gap-2">
                  <span>
                    {b.ingredientName} <span className="text-muted">· {qty(b.remainingQty, b.baseUnit)}</span>
                  </span>
                  <Badge tone={b.expired ? 'bad' : 'warn'}>{b.expired ? 'Expired' : fmtDate(b.expiryDate)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="animate-rise p-5">
          <h2 className="mb-3 text-xl font-bold">Recent transactions</h2>
          <RecentList orders={d.recentOrders} onOpen={setOpenId} />
        </Card>
      </div>
      <OrderDetailModal orderId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function StockCard({ low }: { low: LowStock[] }) {
  return (
    <Card className="animate-rise p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xl font-bold">Low stock</h2>
        <Link href="/inventory/" className="text-xs font-semibold text-brand">
          Inventory →
        </Link>
      </div>
      {low.length === 0 ? (
        <p className="text-sm text-muted">Everything is above its low-stock level.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {low.slice(0, 8).map((i) => (
            <li key={i.id} className="flex justify-between gap-2">
              <span>{i.name}</span>
              <Badge tone={i.level === 'OUT' ? 'bad' : 'warn'}>
                {i.level === 'OUT' ? '' : ''}
                {qty(i.stockQty, i.baseUnit)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentList({ orders, onOpen }: { orders: Order[]; onOpen: (id: string) => void }) {
  if (!orders.length) return <p className="text-sm text-muted">No orders yet.</p>;
  return (
    <ul className="divide-y divide-line/60">
      {orders.slice(0, 8).map((o) => (
        <li key={o.id}>
          <button className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:text-brand" onClick={() => onOpen(o.id)}>
            <span className="min-w-0">
              <span className="font-semibold">
                {o.reference.split('-').pop()}
              </span>
              <span className="block text-xs text-muted">{fmtDateTime(o.createdAt)}</span>
            </span>
            <span className="flex flex-col items-end gap-1">
              <span className="tabular">{peso(o.totalCentavos)}</span>
              <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function CashierDashboard() {
  const { unsyncedCount, settings } = usePos();
  const walkInOnly = settings?.walkInOnly ?? true;
  const [d, setD] = useState<CashierDash | null>(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const load = () => api.get<CashierDash>('/dashboard/cashier').then(setD, (e) => setError(errorMessage(e)));
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!d) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="hover-lift animate-rise p-5 md:col-span-2">
          {d.shift ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="label">Your cash drawer</p>
                <p className="font-heading text-2xl font-bold">Open since {fmtDateTime(d.shift.shift.openedAt)}</p>
                <p className="text-sm text-muted">
                  {d.shift.orderCount} {walkInOnly ? 'sales' : 'orders'} · {peso(d.shift.totalSalesCentavos)} total · drawer should have {peso(d.shift.expectedCashCentavos)}
                </p>
              </div>
              <Link href="/pos/">
                <Button size="lg">Open POS</Button>
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="label">Your cash drawer</p>
                <p className="font-heading text-2xl font-bold">Not started</p>
                <p className="text-sm text-muted">Count the cash and open the drawer before selling.</p>
              </div>
              <Link href="/shift/">
                <Button size="lg">Open drawer</Button>
              </Link>
            </div>
          )}
        </Card>
        <Stat label="Waiting to sync" value={unsyncedCount} hint={unsyncedCount ? 'Orders saved offline on this device' : 'All synced'} tone={unsyncedCount ? 'warn' : 'ok'} delay={60} />
      </div>
      {walkInOnly ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="animate-rise p-5 lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-bold">My recent sales</h2>
              <Link href="/orders/" className="text-xs font-semibold text-brand">
                All sales →
              </Link>
            </div>
            <RecentList orders={d.recentOrders} onOpen={setOpenId} />
          </Card>
          <StockCard low={d.lowStock} />
        </div>
      ) : (
      <>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="animate-rise p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-bold">Active queue</h2>
            <Link href="/orders/" className="text-xs font-semibold text-brand">
              Open board →
            </Link>
          </div>
          {d.queue.length === 0 ? (
            <EmptyState title="No active orders" />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {d.queue.slice(0, 10).map((o) => (
                <li key={o.id}>
                  <button className="hover-lift w-full rounded-2xl border border-line bg-canvas/60 p-3 text-left" onClick={() => setOpenId(o.id)}>
                    <div className="flex justify-between">
                      <span className="font-heading font-bold">
                        {o.reference.split('-').pop()}
                      </span>
                      <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
                    </div>
                    <p className="text-xs text-muted">
                      {minutesAgo(o.createdAt)} · {o.items.reduce((s, i) => s + i.quantity, 0)} items
                    </p>
                    <div className="mt-1 flex justify-between text-sm">
                      <span className="tabular">{peso(o.totalCentavos)}</span>
                      <Badge tone={PAY_TONE[o.paymentStatus]}>{PAY_LABEL[o.paymentStatus]}</Badge>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <StockCard low={d.lowStock} />
      </div>
      <Card className="animate-rise p-5">
        <h2 className="mb-3 text-xl font-bold">My recent orders</h2>
        <RecentList orders={d.recentOrders} onOpen={setOpenId} />
      </Card>
      </>
      )}
      <OrderDetailModal orderId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
