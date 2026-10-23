'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { usePos } from '@/lib/offline/pos-context';
import { peso } from '@/lib/money';
import type { DeliveryArea, Settings } from '@/lib/types';
import { Badge, Button, Card, ErrorNote, Field, Modal, MoneyField, PageHeader, SelectField, Skeleton } from '@/components/ui';
import { NeedsOnline, OwnerOnly } from '@/components/app-shell';
import { useToast } from '@/components/toast';

export default function SettingsPage() {
  return (
    <OwnerOnly>
      <NeedsOnline>
        <PageHeader eyebrow="Admin" title="Settings" subtitle="Business rules used by the POS and the server. Defaults are placeholders — set them to how your shop works." />
        <div className="grid gap-6 xl:grid-cols-2">
          <BusinessSettings />
          <DeliveryAreas />
        </div>
      </NeedsOnline>
    </OwnerOnly>
  );
}

function BusinessSettings() {
  const toast = useToast();
  const { refreshCatalog } = usePos();
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get<Settings>('/settings').then(setS, (e) => setError(errorMessage(e)));
  }, []);
  if (!s) return <Skeleton className="h-80" />;
  async function save() {
    if (!s) return;
    setBusy(true);
    setError('');
    try {
      setS(await api.patch<Settings>('/settings', s));
      void refreshCatalog().catch(() => {});
      toast('Settings saved', 'ok');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="animate-rise space-y-4 p-5">
      <h2 className="text-xl font-bold">Business rules</h2>
      <Field label="Shop name (receipts)" value={s.shopName} onChange={(e) => setS({ ...s, shopName: e.target.value })} />
      <Field label="Order number prefix" value={s.orderPrefix} maxLength={8} onChange={(e) => setS({ ...s, orderPrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} hint={`Orders look like ${s.orderPrefix}-20251031-0001`} />
      <SelectField label="When stock is not enough" value={s.insufficientStockPolicy} onChange={(e) => setS({ ...s, insufficientStockPolicy: e.target.value as Settings['insufficientStockPolicy'] })}>
        <option value="BLOCK">Block the sale (owner can override, logged)</option>
        <option value="ALLOW">Allow and record negative stock (warning)</option>
      </SelectField>
      <p className="-mt-2 text-xs text-faint">Offline sales are always accepted when they sync (the customer was already served) and are flagged if stock went negative.</p>
      <Field
        label="Max cashier discount (% of subtotal)"
        inputMode="numeric"
        value={String(s.maxCashierDiscountPercent)}
        onChange={(e) => setS({ ...s, maxCashierDiscountPercent: Math.min(100, Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0)) })}
      />
      <MoneyField
        label="Cash difference that needs owner review"
        value={s.cashVarianceReviewThresholdCentavos}
        onChange={(v) => setS({ ...s, cashVarianceReviewThresholdCentavos: v ?? 0 })}
        hint="Shifts that close short or over by more than this are flagged."
      />
      <Field
        label="Warn about expiry this many days ahead"
        inputMode="numeric"
        value={String(s.expiryWarningDays)}
        onChange={(e) => setS({ ...s, expiryWarningDays: Math.min(365, Number(e.target.value.replace(/\D/g, '')) || 0) })}
      />
      <label className="flex items-start gap-3 rounded-xl border border-brand/30 bg-brand-soft/40 p-3 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-pink-500" checked={s.walkInOnly ?? true} onChange={(e) => setS({ ...s, walkInOnly: e.target.checked })} />
        <span>
          <span className="font-semibold">Walk-in only</span>
          <span className="block text-muted">Customers buy and pay at the counter. Every sale is completed right away. There is no order queue and no delivery or Messenger orders. Turn this off when you start taking delivery orders.</span>
        </span>
      </label>
      {!s.walkInOnly && (
      <label className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-pink-500" checked={s.autoCompleteWalkIn ?? true} onChange={(e) => setS({ ...s, autoCompleteWalkIn: e.target.checked })} />
        <span>
          <span className="font-semibold">Quick sale for walk-in customers</span>
          <span className="block text-muted">Paid walk-in orders are recorded as completed right away, without Pending → Preparing → Ready. Turn off if staff should use the order queue for every order.</span>
        </span>
      </label>
      )}
      <ErrorNote>{error}</ErrorNote>
      <Button loading={busy} onClick={save}>
        Save settings
      </Button>
    </Card>
  );
}

function DeliveryAreas() {
  const toast = useToast();
  const { refreshCatalog, settings } = usePos();
  const walkInOnly = settings?.walkInOnly ?? true;
  const [rows, setRows] = useState<DeliveryArea[] | null>(null);
  const [editing, setEditing] = useState<DeliveryArea | 'new' | null>(null);
  const [form, setForm] = useState<{ name: string; fee: number | null; isActive: boolean }>({ name: '', fee: null, isActive: true });
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get<DeliveryArea[]>('/delivery-areas').then(setRows, (e) => toast(errorMessage(e), 'bad'));
  }, [toast]);
  useEffect(load, [load]);
  useEffect(() => {
    const a = editing && editing !== 'new' ? editing : null;
    setForm({ name: a?.name ?? '', fee: a?.feeCentavos ?? null, isActive: a?.isActive ?? true });
    setError('');
  }, [editing]);

  async function save() {
    if (form.fee == null) return setError('Enter the delivery fee (0 for free)');
    try {
      const body = { name: form.name, feeCentavos: form.fee, isActive: form.isActive };
      if (editing && editing !== 'new') await api.patch(`/delivery-areas/${editing.id}`, body);
      else await api.post('/delivery-areas', body);
      toast('Delivery area saved', 'ok');
      setEditing(null);
      load();
      void refreshCatalog().catch(() => {});
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Card className="animate-rise space-y-4 p-5 [animation-delay:80ms]">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Delivery areas</h2>
        <Button size="sm" onClick={() => setEditing('new')}>
          + Area
        </Button>
      </div>
      <p className="text-sm text-muted">Areas and fees offered on delivery and Messenger orders (e.g. Cordova, Lapu-Lapu City).</p>
      {walkInOnly && <p className="rounded-xl border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-warn">Not used right now: the shop is set to walk-in only.</p>}
      {!rows ? (
        <Skeleton className="h-32" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-warn">No delivery areas yet — delivery orders cannot be placed until you add one.</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2.5">
              <span className={a.isActive ? '' : 'opacity-50'}>
                {a.name} {!a.isActive && <Badge>Off</Badge>}
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular text-brand">{peso(a.feeCentavos)}</span>
                <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                  Edit
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New delivery area' : 'Edit delivery area'} footer={<Button onClick={save}>Save</Button>}>
        <div className="space-y-3">
          <Field label="Area name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
          <MoneyField label="Delivery fee" value={form.fee} onChange={(v) => setForm((f) => ({ ...f, fee: v }))} />
          {editing !== 'new' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-pink-500" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
              Offer this area
            </label>
          )}
          <ErrorNote>{error}</ErrorNote>
        </div>
      </Modal>
    </Card>
  );
}
