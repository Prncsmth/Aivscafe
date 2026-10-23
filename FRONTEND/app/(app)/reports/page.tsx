'use client';

import { useEffect, useState } from 'react';
import { api, errorMessage, qs } from '@/lib/api';
import { peso } from '@/lib/money';
import { TYPE_LABEL, addDays, fmtDateTime, manilaDay, qty } from '@/lib/format';
import type { OrderType } from '@/lib/types';
import { Card, EmptyState, ErrorNote, Field, PageHeader, Skeleton, Stat, Table, Tabs } from '@/components/ui';
import { BarChart, RankBars } from '@/components/bar-chart';
import { NeedsOnline, OwnerOnly } from '@/components/app-shell';

interface SalesReport {
  range: { from: string; to: string };
  summary: {
    orderCount: number;
    cancelledOrVoidedCount: number;
    offlineOrderCount: number;
    grossSalesCentavos: number;
    discountsCentavos: number;
    netSalesCentavos: number;
    deliveryFeesCentavos: number;
    averageOrderValueCentavos: number;
    cogsCentavos: number;
    grossProfitCentavos: number;
    operatingExpensesCentavos: number;
    wasteCentavos: number;
    stockAdjustmentLossCentavos: number;
    cancelledOrderLossCentavos: number;
    inventoryLossesCentavos: number;
    netOperatingProfitCentavos: number;
  };
  warnings: string[];
  expensesByCategory: { category: string; amountCentavos: number }[];
  payments: { method: string; kind: string; verification: string; count: number; amountCentavos: number }[];
  byProduct: { name: string; quantity: number; revenueCentavos: number }[];
  byCategory: { name: string; quantity: number; revenueCentavos: number }[];
  byOrderType: { type: OrderType; orders: number; revenueCentavos: number }[];
  byCashier: { cashierId: string; name: string; orders: number; revenueCentavos: number }[];
  byHour: { hour: number; orders: number; revenueCentavos: number }[];
  trend: { day: string; orders: number; revenueCentavos: number }[];
}

const PRESETS = [
  { key: 'today', label: 'Today', range: (t: string) => [t, t] },
  { key: '7d', label: '7 days', range: (t: string) => [addDays(t, -6), t] },
  { key: '30d', label: '30 days', range: (t: string) => [addDays(t, -29), t] },
  { key: 'month', label: 'This month', range: (t: string) => [`${t.slice(0, 8)}01`, t] },
] as const;

export default function ReportsPage() {
  return (
    <OwnerOnly>
      <NeedsOnline>
        <Reports />
      </NeedsOnline>
    </OwnerOnly>
  );
}

function Reports() {
  const today = manilaDay();
  const [preset, setPreset] = useState<string>('7d');
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [r, setR] = useState<SalesReport | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'sales' | 'inventory'>('sales');

  useEffect(() => {
    setR(null);
    setError('');
    api.get<SalesReport>(`/reports/sales${qs({ from, to })}`).then(setR, (e) => setError(errorMessage(e)));
  }, [from, to]);

  function choose(key: string) {
    const p = PRESETS.find((x) => x.key === key)!;
    const [f, t] = p.range(today);
    setPreset(key);
    setFrom(f);
    setTo(t);
  }

  return (
    <>
      <PageHeader
        eyebrow="Business"
        title="Reports"
        subtitle="All figures in Manila time. Profit is an estimate based on recipes and weighted-average ingredient costs."
        actions={<Tabs value={view} onChange={setView} options={[{ value: 'sales', label: 'Sales & profit' }, { value: 'inventory', label: 'Inventory' }]} />}
      />
      {/* Filters in one row above the charts */}
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <Tabs value={preset} onChange={choose} options={PRESETS.map((p) => ({ value: p.key, label: p.label }))} />
        <Field label="From" type="date" value={from} max={to} onChange={(e) => (setPreset(''), setFrom(e.target.value))} />
        <Field label="To" type="date" value={to} min={from} onChange={(e) => (setPreset(''), setTo(e.target.value))} />
      </div>
      <ErrorNote>{error}</ErrorNote>
      {view === 'sales' ? r ? <SalesView r={r} /> : !error && <Skeleton className="h-96" /> : <InventoryView from={from} to={to} />}
    </>
  );
}

function SalesView({ r }: { r: SalesReport }) {
  const s = r.summary;
  const single = r.range.from === r.range.to;
  const gcashUnverified = r.payments.filter((p) => p.method === 'GCASH' && p.kind === 'PAYMENT' && p.verification === 'UNVERIFIED').reduce((a, p) => a + p.amountCentavos, 0);
  const byMethod = (m: string, kind = 'PAYMENT') => r.payments.filter((p) => p.method === m && p.kind === kind).reduce((a, p) => a + p.amountCentavos, 0);
  const peakHours = r.byHour.filter((h) => h.orders > 0);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Net sales (revenue)" value={peso(s.netSalesCentavos)} hint={`Gross ${peso(s.grossSalesCentavos)} − discounts ${peso(s.discountsCentavos)}`} />
        <Stat label="Orders" value={s.orderCount} hint={`${s.cancelledOrVoidedCount} cancelled/voided · ${s.offlineOrderCount} offline`} delay={50} />
        <Stat label="Average order" value={peso(s.averageOrderValueCentavos)} delay={100} />
        <Stat label="Delivery fees" value={peso(s.deliveryFeesCentavos)} delay={150} />
      </div>

      {/* Profit statement — every line labelled for what it is */}
      <Card className="animate-rise p-5">
        <h2 className="mb-3 text-xl font-bold">Profit estimate</h2>
        <dl className="max-w-xl space-y-1.5 text-sm">
          <PL label="Net sales (after discounts)" v={s.netSalesCentavos} />
          <PL label="− Cost of goods sold (recipe ingredients)" v={-s.cogsCentavos} />
          <PL label="= Estimated gross profit" v={s.grossProfitCentavos} strong />
          <PL label="+ Delivery fee income" v={s.deliveryFeesCentavos} />
          <PL label="− Operating expenses (recorded)" v={-s.operatingExpensesCentavos} />
          <PL label="− Waste & spoilage" v={-s.wasteCentavos} />
          <PL label="− Stock count losses" v={-s.stockAdjustmentLossCentavos} />
          <PL label="− Ingredients of cancelled/voided orders" v={-s.cancelledOrderLossCentavos} />
          <PL label="= Estimated net operating profit" v={s.netOperatingProfitCentavos} strong />
        </dl>
        {r.warnings.length > 0 && (
          <ul className="mt-4 list-disc space-y-1 rounded-2xl border border-warn/30 bg-warn/5 p-3 pl-8 text-xs text-warn">
            {r.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-faint">Ingredient purchases are inventory, not expenses; they appear here as COGS when used. Taxes and owner&apos;s salary are not included unless recorded as expenses.</p>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        {!single && (
          <Card className="animate-rise p-5">
            <h2 className="mb-1 text-xl font-bold">Daily sales</h2>
            <p className="mb-3 text-xs text-muted">Order totals per day, including delivery fees.</p>
            <BarChart ariaLabel="Daily sales" data={r.trend.map((t) => ({ key: t.day, label: t.day.slice(5).replace('-', '/'), value: t.revenueCentavos, detail: `${t.orders} orders` }))} format={peso} labelEvery={Math.ceil(r.trend.length / 10)} />
          </Card>
        )}
        <Card className="animate-rise p-5">
          <h2 className="mb-1 text-xl font-bold">Busy hours</h2>
          <p className="mb-3 text-xs text-muted">Sales by hour of day.</p>
          {peakHours.length === 0 ? (
            <EmptyState title="No sales in this range" />
          ) : (
            <BarChart
              ariaLabel="Sales by hour of day"
              data={r.byHour.slice(Math.min(...peakHours.map((h) => h.hour)), Math.max(...peakHours.map((h) => h.hour)) + 1).map((h) => ({
                key: String(h.hour),
                label: `${h.hour % 12 || 12}${h.hour < 12 ? 'a' : 'p'}`,
                value: h.revenueCentavos,
                detail: `${h.orders} orders`,
              }))}
              format={peso}
            />
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="animate-rise p-5">
          <h2 className="mb-3 text-xl font-bold">Best sellers</h2>
          {r.byProduct.length ? <RankBars rows={r.byProduct.slice(0, 10).map((p) => ({ name: p.name, value: p.quantity, sub: peso(p.revenueCentavos) }))} format={(v) => `${v}`} /> : <EmptyState title="No sales" />}
        </Card>
        <Card className="animate-rise p-5">
          <h2 className="mb-3 text-xl font-bold">By category</h2>
          {r.byCategory.length ? <RankBars rows={r.byCategory.map((c) => ({ name: c.name, value: c.revenueCentavos, sub: `${c.quantity} sold` }))} format={peso} /> : <EmptyState title="No sales" />}
        </Card>
        <Card className="animate-rise space-y-4 p-5">
          <div>
            <h2 className="mb-2 text-xl font-bold">Payments</h2>
            <Row l="Cash received" v={peso(byMethod('CASH'))} />
            <Row l="GCash received" v={peso(byMethod('GCASH'))} />
            {gcashUnverified > 0 && <Row l="  of which unverified" v={peso(gcashUnverified)} warn />}
            <Row l="Refunds (cash + GCash)" v={peso(byMethod('CASH', 'REFUND') + byMethod('GCASH', 'REFUND'))} />
          </div>
          <div>
            <h3 className="mb-2 font-bold">Order types</h3>
            {r.byOrderType.map((t) => (
              <Row key={t.type} l={`${TYPE_LABEL[t.type]} (${t.orders})`} v={peso(t.revenueCentavos)} />
            ))}
          </div>
          <div>
            <h3 className="mb-2 font-bold">By cashier</h3>
            {r.byCashier.map((c) => (
              <Row key={c.cashierId} l={`${c.name} (${c.orders})`} v={peso(c.revenueCentavos)} />
            ))}
          </div>
          <div>
            <h3 className="mb-2 font-bold">Expenses by category</h3>
            {r.expensesByCategory.length === 0 ? <p className="text-sm text-muted">None recorded.</p> : r.expensesByCategory.map((e) => <Row key={e.category} l={e.category.toLowerCase()} v={peso(e.amountCentavos)} />)}
          </div>
        </Card>
      </div>
      <ShiftsTable from={r.range.from} to={r.range.to} />
    </div>
  );
}

function ShiftsTable({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<{ shift: { id: string; openedAt: string; closedAt: string | null; cashVarianceCentavos: number | null; user?: { name: string } }; totalSalesCentavos: number; orderCount: number; expectedCashCentavos: number; expectedGcashCentavos: number }[] | null>(null);
  useEffect(() => {
    api.get<typeof rows>(`/reports/shifts${qs({ from, to })}`).then(setRows, () => setRows([]));
  }, [from, to]);
  if (!rows || rows.length === 0) return null;
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-xl font-bold">Sales by shift</h2>
      <Table head={['Cashier', 'Opened', 'Closed', 'Orders', 'Sales', 'Expected cash', 'GCash', 'Cash diff']}>
        {rows.map((s) => (
          <tr key={s.shift.id}>
            <td className="px-3 py-2">{s.shift.user?.name}</td>
            <td className="px-3 py-2 text-muted">{fmtDateTime(s.shift.openedAt)}</td>
            <td className="px-3 py-2 text-muted">{s.shift.closedAt ? fmtDateTime(s.shift.closedAt) : 'open'}</td>
            <td className="tabular px-3 py-2">{s.orderCount}</td>
            <td className="tabular px-3 py-2">{peso(s.totalSalesCentavos)}</td>
            <td className="tabular px-3 py-2">{peso(s.expectedCashCentavos)}</td>
            <td className="tabular px-3 py-2">{peso(s.expectedGcashCentavos)}</td>
            <td className={`tabular px-3 py-2 ${s.shift.cashVarianceCentavos ? 'text-bad' : 'text-muted'}`}>{s.shift.cashVarianceCentavos != null ? peso(s.shift.cashVarianceCentavos) : '—'}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

interface ConsumptionRow {
  ingredientId: string;
  name: string;
  baseUnit: string;
  [type: string]: unknown;
}
function InventoryView({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<ConsumptionRow[] | null>(null);
  const [waste, setWaste] = useState<{ id: string; quantity: string; valueCentavos: number; reason: string | null; createdAt: string; ingredient: { name: string; baseUnit: string }; user: { name: string } | null }[] | null>(null);
  useEffect(() => {
    setRows(null);
    setWaste(null);
    api.get<ConsumptionRow[]>(`/reports/inventory-consumption${qs({ from, to })}`).then(setRows, () => setRows([]));
    api.get<typeof waste>(`/reports/waste${qs({ from, to })}`).then(setWaste, () => setWaste([]));
  }, [from, to]);
  const cell = (r: ConsumptionRow, t: string, negate = false) => {
    const v = r[t] as { quantity: string; valueCentavos: number } | undefined;
    if (!v) return <span className="text-faint">—</span>;
    const q = negate ? -Number(v.quantity) : Number(v.quantity);
    return (
      <>
        {qty(q, r.baseUnit)}
        <span className="block text-xs text-faint">{peso(Math.abs(v.valueCentavos))}</span>
      </>
    );
  };
  return (
    <div className="space-y-6">
      <Card className="p-4">
        <h2 className="mb-3 text-xl font-bold">Ingredient usage</h2>
        {!rows ? (
          <Skeleton className="h-48" />
        ) : rows.length === 0 ? (
          <EmptyState title="No stock movements in this range" />
        ) : (
          <Table head={['Ingredient', 'Used in sales', 'Restored', 'Purchased', 'Waste', 'Count adj.']}>
            {rows.map((r) => (
              <tr key={r.ingredientId}>
                <td className="px-3 py-2 font-semibold">{r.name}</td>
                <td className="tabular px-3 py-2">{cell(r, 'SALE', true)}</td>
                <td className="tabular px-3 py-2">{cell(r, 'SALE_REVERSAL')}</td>
                <td className="tabular px-3 py-2">{cell(r, 'PURCHASE')}</td>
                <td className="tabular px-3 py-2 text-bad">{cell(r, 'WASTE', true)}</td>
                <td className="tabular px-3 py-2">{cell(r, 'ADJUSTMENT')}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card className="p-4">
        <h2 className="mb-3 text-xl font-bold">Waste & spoilage log</h2>
        {!waste ? (
          <Skeleton className="h-32" />
        ) : waste.length === 0 ? (
          <EmptyState title="No waste recorded " />
        ) : (
          <Table head={['When', 'Ingredient', 'Qty', 'Value', 'Reason', 'By']}>
            {waste.map((w) => (
              <tr key={w.id}>
                <td className="px-3 py-2 text-muted">{fmtDateTime(w.createdAt)}</td>
                <td className="px-3 py-2">{w.ingredient.name}</td>
                <td className="tabular px-3 py-2">{qty(-Number(w.quantity), w.ingredient.baseUnit)}</td>
                <td className="tabular px-3 py-2">{peso(Math.abs(w.valueCentavos))}</td>
                <td className="px-3 py-2 text-muted">{w.reason}</td>
                <td className="px-3 py-2 text-muted">{w.user?.name}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function PL({ label, v, strong }: { label: string; v: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'border-t border-line pt-1.5 font-heading text-base font-bold' : 'text-muted'}`}>
      <dt>{label}</dt>
      <dd className={`tabular ${strong && v < 0 ? 'text-bad' : strong ? 'text-ink' : ''}`}>{peso(v)}</dd>
    </div>
  );
}

function Row({ l, v, warn }: { l: string; v: string; warn?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 text-sm ${warn ? 'text-warn' : ''}`}>
      <span className="text-muted capitalize">{l}</span>
      <span className="tabular">{v}</span>
    </div>
  );
}

