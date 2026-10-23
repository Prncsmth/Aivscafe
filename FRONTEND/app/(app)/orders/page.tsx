'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, qs, request } from '@/lib/api';
import { usePos } from '@/lib/offline/pos-context';
import { peso } from '@/lib/money';
import { PAY_LABEL, PAY_TONE, STATUS_LABEL, STATUS_TONE, TYPE_LABEL, actionLabel, fmtDateTime, fmtTime, manilaDay, minutesSince, nextStatus } from '@/lib/format';
import type { Order, OrderStatus } from '@/lib/types';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, PageHeader, SelectField, Skeleton, Table, Tabs, cx } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { NeedsOnline } from '@/components/app-shell';
import { OrderDetailModal } from '@/components/order-detail';
import { useToast } from '@/components/toast';

const COLUMNS: { status: OrderStatus; title: string; hint: string; dot: string }[] = [
  { status: 'PENDING', title: 'New', hint: 'Not started yet', dot: 'bg-warn' },
  { status: 'PREPARING', title: 'Preparing', hint: 'Being made now', dot: 'bg-info' },
  { status: 'READY', title: 'Ready', hint: 'Waiting for pickup or rider', dot: 'bg-brand' },
  { status: 'OUT_FOR_DELIVERY', title: 'Out for delivery', hint: 'On the way', dot: 'bg-ok' },
];

type TypeFilter = 'ALL' | 'WALK_IN' | 'DELIVERY';

export default function OrdersPage() {
  const walkInOnly = usePos().settings?.walkInOnly ?? true;
  const [tab, setTab] = useState<'queue' | 'history'>('queue');
  const [open, setOpen] = useState<{ id: string; pay?: boolean } | null>(null);
  const [version, setVersion] = useState(0);
  if (walkInOnly) {
    // Walk-in shop: every sale is completed at the counter, so there is no queue — just the list of sales.
    return (
      <NeedsOnline>
        <PageHeader eyebrow="Daily operations" title="Sales" subtitle="Every sale made at the counter. Tap a sale to see the receipt, verify GCash, or refund/void it." />
        <History onOpen={(id) => setOpen({ id })} version={version} walkInOnly />
        <OrderDetailModal orderId={open?.id ?? null} onClose={() => setOpen(null)} onChanged={() => setVersion((v) => v + 1)} />
      </NeedsOnline>
    );
  }
  return (
    <NeedsOnline>
      <PageHeader
        eyebrow="Daily operations"
        title="Orders"
        subtitle={tab === 'queue' ? 'Orders being prepared right now. Tap the button on a card to move it to the next step.' : 'Every order, with filters by date, status, type and payment.'}
        actions={<Tabs value={tab} onChange={setTab} options={[{ value: 'queue', label: 'Live queue' }, { value: 'history', label: 'History' }]} />}
      />
      {tab === 'queue' ? <Queue onOpen={(id, pay) => setOpen({ id, pay })} version={version} /> : <History onOpen={(id) => setOpen({ id })} version={version} />}
      <OrderDetailModal orderId={open?.id ?? null} autoPay={open?.pay} onClose={() => setOpen(null)} onChanged={() => setVersion((v) => v + 1)} />
    </NeedsOnline>
  );
}

const TYPE_ICON: Record<Order['type'], IconName> = { WALK_IN: 'walk', DELIVERY: 'bike', MESSENGER: 'chat' };

/** Waiting time: neutral, then amber after 10 min, red after 20 min. */
function WaitTime({ since }: { since: string }) {
  const m = minutesSince(since);
  const tone = m >= 20 ? 'bg-bad/10 text-bad' : m >= 10 ? 'bg-warn/10 text-warn' : 'bg-subtle text-muted';
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular', tone)} title={`Placed ${fmtTime(since)}`}>
      <Icon name="clock" className="h-3.5 w-3.5" />
      {m < 1 ? 'now' : `${m} min`}
    </span>
  );
}

function Queue({ onOpen, version }: { onOpen: (id: string, pay?: boolean) => void; version: number }) {
  const toast = useToast();
  const { online } = usePos();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState('');
  const [moving, setMoving] = useState<string | null>(null);
  const [filter, setFilter] = useState<TypeFilter>('ALL');
  const [mobileCol, setMobileCol] = useState<OrderStatus>('PENDING');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try {
      setOrders(await api.get<Order[]>('/orders/queue'));
      setUpdatedAt(new Date());
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
    if (!online) return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load, version, online]);
  // Re-render every 30 s so waiting times stay current between refreshes.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  async function advance(o: Order) {
    const to = nextStatus(o.status, !!o.delivery);
    if (!to) return;
    setMoving(o.id);
    try {
      await api.post(`/orders/${o.id}/status`, { to });
      toast(`Order #${o.reference.split('-').pop()}: ${STATUS_LABEL[to]}`, 'ok');
      await load();
    } catch (e) {
      toast(errorMessage(e), 'bad');
    } finally {
      setMoving(null);
    }
  }

  if (!orders) return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64" />)}</div>;

  const visible = orders.filter((o) => filter === 'ALL' || (filter === 'DELIVERY' ? !!o.delivery : !o.delivery));
  const hasDelivery = orders.some((o) => o.delivery);
  const columns = COLUMNS.filter((c) => c.status !== 'OUT_FOR_DELIVERY' || hasDelivery || filter === 'DELIVERY');
  const count = (s: OrderStatus) => visible.filter((o) => o.status === s).length;

  return (
    <div className="space-y-4">
      <ErrorNote>{error}</ErrorNote>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'ALL', label: `All (${orders.length})` },
            { value: 'WALK_IN', label: `Pick-up (${orders.filter((o) => !o.delivery).length})` },
            { value: 'DELIVERY', label: `Delivery (${orders.filter((o) => o.delivery).length})` },
          ]}
        />
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Icon name="sync" className="h-3.5 w-3.5" />
          Updates automatically{updatedAt && ` · last ${fmtTime(updatedAt)}`}
        </p>
      </div>

      {/* Phones: one status at a time */}
      <div className="md:hidden">
        <Tabs value={mobileCol} onChange={setMobileCol} options={columns.map((c) => ({ value: c.status, label: `${c.title} (${count(c.status)})` }))} />
      </div>

      {visible.length === 0 ? (
        <Card className="p-2">
          <EmptyState title="No active orders">New orders from the POS appear here. Paid walk-in sales are completed right away and go straight to History.</EmptyState>
        </Card>
      ) : (
        <div className={cx('grid gap-4', columns.length === 4 ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3')}>
          {columns.map((col) => {
            const list = visible.filter((o) => o.status === col.status);
            return (
              <section key={col.status} className={cx('min-w-0', mobileCol !== col.status && 'hidden md:block')} aria-label={col.title}>
                <header className="mb-2 hidden px-1 md:block">
                  <h2 className="flex items-center gap-2 font-heading font-bold">
                    <span className={cx('h-2.5 w-2.5 rounded-full', col.dot)} />
                    {col.title}
                    <span className="text-sm font-semibold text-muted">{list.length}</span>
                  </h2>
                  <p className="text-xs text-faint">{col.hint}</p>
                </header>
                <div className="space-y-3">
                  {list.length === 0 && <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-faint">No orders here</p>}
                  {list.map((o) => (
                    <QueueCard key={o.id} o={o} moving={moving === o.id} onOpen={onOpen} onAdvance={advance} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QueueCard({ o, moving, onOpen, onAdvance }: { o: Order; moving: boolean; onOpen: (id: string, pay?: boolean) => void; onAdvance: (o: Order) => void }) {
  const isDelivery = !!o.delivery;
  const to = nextStatus(o.status, isDelivery);
  const needsPay = (to === 'COMPLETED' || to === 'DELIVERED') && o.paymentStatus !== 'PAID';
  const itemCount = o.items.reduce((s, i) => s + i.quantity, 0);
  return (
    <article className="card animate-pop overflow-hidden">
      <button className="block w-full p-3.5 text-left hover:bg-subtle/50" onClick={() => onOpen(o.id)} aria-label={`Open order ${o.reference}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-heading text-lg leading-tight font-bold">#{o.reference.split('-').pop()}</p>
            <p className="flex items-center gap-1 truncate text-sm text-muted">
              <Icon name={TYPE_ICON[o.type]} className="h-4 w-4 shrink-0" />
              {o.customerName ?? TYPE_LABEL[o.type]}
            </p>
          </div>
          <WaitTime since={o.createdAt} />
        </div>
        <ul className="mt-2.5 space-y-1 text-sm">
          {o.items.slice(0, 4).map((i) => (
            <li key={i.id} className="flex gap-2">
              <span className="tabular w-6 shrink-0 font-semibold">{i.quantity}×</span>
              <span className="min-w-0">
                {i.productName} <span className="text-muted">· {i.variantName}</span>
                {i.modifiers.length > 0 && <span className="block text-xs text-muted">+ {i.modifiers.map((m) => m.name).join(', ')}</span>}
                {i.notes && <span className="block text-xs text-info italic">“{i.notes}”</span>}
              </span>
            </li>
          ))}
          {o.items.length > 4 && <li className="pl-8 text-xs text-muted">+{o.items.length - 4} more item(s)</li>}
        </ul>
        {o.delivery && (
          <p className="mt-2 truncate rounded-lg bg-subtle px-2 py-1 text-xs text-muted" title={o.delivery.address}>
            {o.delivery.areaName} · {o.delivery.address}
          </p>
        )}
        <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
          <span className="text-xs text-muted">
            {itemCount} item{itemCount === 1 ? '' : 's'} · <span className="tabular font-semibold text-ink">{peso(o.totalCentavos)}</span>
          </span>
          <Badge tone={PAY_TONE[o.paymentStatus]}>{PAY_LABEL[o.paymentStatus]}</Badge>
        </div>
      </button>
      {to && (
        <div className="border-t border-line bg-subtle/40 p-2.5">
          {needsPay ? (
            <Button size="sm" variant="secondary" className="w-full" onClick={() => onOpen(o.id, true)}>
              <Icon name="cash" className="h-4 w-4" /> Collect payment
            </Button>
          ) : (
            <Button size="sm" variant={to === 'COMPLETED' || to === 'DELIVERED' ? 'primary' : 'secondary'} className="w-full" loading={moving} onClick={() => onAdvance(o)}>
              {actionLabel(to, isDelivery)}
              <Icon name="arrowRight" className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

function History({ onOpen, version, walkInOnly = false }: { onOpen: (id: string) => void; version: number; walkInOnly?: boolean }) {
  const today = manilaDay();
  const [f, setF] = useState({ q: '', status: '', type: '', paymentStatus: '', from: today, to: today });
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Order[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(null);
    request<Order[]>(`/orders${qs({ ...f, page, pageSize: 25 })}`).then(
      (r) => {
        setRows(r.data);
        setTotal(Number(r.meta?.total ?? 0));
      },
      (e) => setError(errorMessage(e)),
    );
  }, [f, page, version]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setPage(1);
    setF((x) => ({ ...x, [k]: e.target.value }));
  };

  return (
    <Card className="p-4">
      <div className={cx('mb-4 grid gap-3 sm:grid-cols-3', walkInOnly ? 'lg:grid-cols-5' : 'lg:grid-cols-6')}>
        <Field label="Search ref / name" value={f.q} onChange={set('q')} placeholder="AIV-… or OFF-…" />
        <SelectField label="Status" value={f.status} onChange={set('status')}>
          <option value="">All</option>
          {Object.entries(STATUS_LABEL)
            .filter(([k]) => !walkInOnly || ['COMPLETED', 'VOIDED', 'CANCELLED'].includes(k))
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </SelectField>
        {!walkInOnly && (
        <SelectField label="Type" value={f.type} onChange={set('type')}>
          <option value="">All</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
        )}
        <SelectField label="Payment" value={f.paymentStatus} onChange={set('paymentStatus')}>
          <option value="">All</option>
          {Object.entries(PAY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
        <Field label="From" type="date" value={f.from} onChange={set('from')} />
        <Field label="To" type="date" value={f.to} onChange={set('to')} />
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!rows ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <EmptyState title={walkInOnly ? 'No sales found' : 'No orders found'}>Try a different date range or filter.</EmptyState>
      ) : (
        <>
          <Table head={['Reference', 'Time', walkInOnly ? 'Items' : 'Type', 'Status', 'Payment', 'Total', 'Cashier']}>
            {rows.map((o) => (
              <tr key={o.id} className="cursor-pointer transition hover:bg-subtle/60" onClick={() => onOpen(o.id)}>
                <td className="px-3 py-2.5 font-semibold">
                  {o.reference}
                  {o.source === 'OFFLINE_SYNC' && <span className="ml-2 text-xs text-info">offline</span>}
                </td>
                <td className="px-3 py-2.5 text-muted">{fmtDateTime(o.createdAt)}</td>
                <td className="max-w-xs truncate px-3 py-2.5 text-muted">
                  {walkInOnly ? o.items.map((i) => `${i.quantity}× ${i.productName}`).join(', ') : TYPE_LABEL[o.type]}
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone={PAY_TONE[o.paymentStatus]}>{PAY_LABEL[o.paymentStatus]}</Badge>
                </td>
                <td className="tabular px-3 py-2.5 font-semibold">{peso(o.totalCentavos)}</td>
                <td className="px-3 py-2.5 text-muted">{o.cashier.name}</td>
              </tr>
            ))}
          </Table>
          <div className={cx('mt-4 flex items-center justify-between text-sm text-muted')}>
            <span>{total} {walkInOnly ? (total === 1 ? "sale" : "sales") : total === 1 ? "order" : "orders"}</span>
            <span className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ← Prev
              </Button>
              <Button size="sm" variant="secondary" disabled={page * 25 >= total} onClick={() => setPage((p) => p + 1)}>
                Next →
              </Button>
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
