'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, qs, request } from '@/lib/api';
import { peso } from '@/lib/money';
import { fmtDate, qty } from '@/lib/format';
import type { BaseUnit, Ingredient, Unit } from '@/lib/types';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, MoneyField, PageHeader, SelectField, Skeleton, Table, Tabs, TextArea } from '@/components/ui';
import { NeedsOnline, OwnerOnly } from '@/components/app-shell';
import { useToast } from '@/components/toast';

const UNITS_FOR: Record<BaseUnit, Unit[]> = { G: ['KG', 'G'], ML: ['L', 'ML'], PCS: ['PCS'] };

interface Supplier {
  id: string;
  name: string;
  contact: string | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
}
interface Purchase {
  id: string;
  reference: string | null;
  purchasedAt: string;
  totalCentavos: number;
  notes: string | null;
  supplier: { name: string } | null;
  user: { name: string };
  items: { id: string; quantity: string; unit: string; baseQuantity: string; totalCostCentavos: number; expiryDate: string | null; ingredient: { name: string; baseUnit: string } }[];
}

export default function PurchasesPage() {
  const [tab, setTab] = useState<'purchases' | 'suppliers'>('purchases');
  return (
    <OwnerOnly>
      <NeedsOnline>
        <PageHeader
          eyebrow="Stock"
          title="Purchases & Suppliers"
          subtitle="Recording a purchase adds the stock, sets expiry batches and updates the average cost used for profit."
          actions={<Tabs value={tab} onChange={setTab} options={[{ value: 'purchases', label: 'Purchases' }, { value: 'suppliers', label: 'Suppliers' }]} />}
        />
        {tab === 'purchases' ? <Purchases /> : <Suppliers />}
      </NeedsOnline>
    </OwnerOnly>
  );
}

function Purchases() {
  const toast = useToast();
  const [rows, setRows] = useState<Purchase[] | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    request<Purchase[]>(`/purchases${qs({ pageSize: 50 })}`).then((r) => setRows(r.data), (e) => toast(errorMessage(e), 'bad'));
  }, [toast]);
  useEffect(load, [load]);
  return (
    <div className="space-y-4">
      <Button onClick={() => setOpen(true)}>+ Record purchase</Button>
      <Card className="p-2">
        {!rows ? (
          <Skeleton className="h-48" />
        ) : rows.length === 0 ? (
          <EmptyState title="No purchases yet">Record what you buy from the market or suppliers to keep stock and costs accurate.</EmptyState>
        ) : (
          <Table head={['Date', 'Supplier', 'Items', 'Total', 'By']}>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(p.purchasedAt)}</td>
                <td className="px-3 py-2.5">
                  {p.supplier?.name ?? '—'}
                  {p.reference && <span className="block text-xs text-muted">ref {p.reference}</span>}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted">
                  {p.items.map((i) => (
                    <span key={i.id} className="block">
                      {i.ingredient.name}: {Number(i.quantity)} {i.unit.toLowerCase()} · {peso(i.totalCostCentavos)}
                      {i.expiryDate && ` · exp ${fmtDate(i.expiryDate)}`}
                    </span>
                  ))}
                </td>
                <td className="tabular px-3 py-2.5 font-semibold">{peso(p.totalCentavos)}</td>
                <td className="px-3 py-2.5 text-muted">{p.user.name}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <PurchaseModal open={open} onClose={() => setOpen(false)} onSaved={load} />
    </div>
  );
}

type Line = { ingredientId: string; quantity: string; unit: Unit | ''; cost: number | null; expiryDate: string; batchCode: string };
const blank: Line = { ingredientId: '', quantity: '', unit: '', cost: null, expiryDate: '', batchCode: '' };

function PurchaseModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [head, setHead] = useState({ supplierId: '', reference: '', purchasedAt: '', notes: '' });
  const [lines, setLines] = useState<Line[]>([{ ...blank }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setLines([{ ...blank }]);
    setHead({ supplierId: '', reference: '', purchasedAt: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }), notes: '' });
    Promise.all([api.get<Ingredient[]>('/ingredients'), api.get<Supplier[]>('/suppliers')]).then(([i, s]) => {
      setIngredients(i);
      setSuppliers(s.filter((x) => x.isActive));
    });
  }, [open]);

  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const total = lines.reduce((s, l) => s + (l.cost ?? 0), 0);

  async function save() {
    const valid = lines.filter((l) => l.ingredientId);
    if (!valid.length) return setError('Add at least one ingredient');
    if (valid.some((l) => !(Number(l.quantity) > 0) || l.cost == null)) return setError('Each line needs a quantity and the total amount paid');
    setBusy(true);
    setError('');
    try {
      await api.post('/purchases', {
        supplierId: head.supplierId || null,
        reference: head.reference || null,
        purchasedAt: head.purchasedAt ? new Date(`${head.purchasedAt}T12:00:00+08:00`).toISOString() : undefined,
        notes: head.notes || null,
        items: valid.map((l) => ({
          ingredientId: l.ingredientId,
          quantity: l.quantity,
          unit: l.unit || byId.get(l.ingredientId)!.baseUnit,
          totalCostCentavos: l.cost,
          expiryDate: l.expiryDate ? new Date(`${l.expiryDate}T23:59:00+08:00`).toISOString() : null,
          batchCode: l.batchCode || null,
        })),
      });
      toast('Purchase recorded and stock updated', 'ok');
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Record purchase"
      footer={
        <Button loading={busy} onClick={save}>
          Save · {peso(total)}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label="Supplier" value={head.supplierId} onChange={(e) => setHead((h) => ({ ...h, supplierId: e.target.value }))}>
            <option value="">— (market / none)</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <Field label="Date" type="date" value={head.purchasedAt} onChange={(e) => setHead((h) => ({ ...h, purchasedAt: e.target.value }))} />
          <Field label="Receipt / ref" value={head.reference} onChange={(e) => setHead((h) => ({ ...h, reference: e.target.value }))} />
        </div>
        {lines.map((l, i) => {
          const ing = byId.get(l.ingredientId);
          const set = (patch: Partial<Line>) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={i} className="grid gap-2 rounded-2xl border border-line bg-canvas/40 p-3 sm:grid-cols-[2fr_1fr_90px_1fr_1fr_auto]">
              <SelectField label="Ingredient" value={l.ingredientId} onChange={(e) => set({ ingredientId: e.target.value, unit: '' })}>
                <option value="">Choose…</option>
                {ingredients.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </SelectField>
              <Field label="Qty" inputMode="decimal" value={l.quantity} onChange={(e) => set({ quantity: e.target.value })} />
              <SelectField label="Unit" value={l.unit || UNITS_FOR[ing?.baseUnit ?? 'PCS'][0]} onChange={(e) => set({ unit: e.target.value as Unit })} disabled={!ing}>
                {UNITS_FOR[ing?.baseUnit ?? 'PCS'].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </SelectField>
              <MoneyField label="Total paid" value={l.cost} onChange={(c) => set({ cost: c })} />
              <Field label="Expiry" type="date" value={l.expiryDate} onChange={(e) => set({ expiryDate: e.target.value })} />
              <Button variant="ghost" size="sm" className="self-end" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))}>
                ✕
              </Button>
              {ing && l.quantity && Number(l.quantity) > 0 && l.cost != null && (
                <p className="text-xs text-faint sm:col-span-6">
                  Now on hand {qty(ing.stockQty, ing.baseUnit)} · this batch costs{' '}
                  {peso(Math.round(l.cost / (Number(l.quantity) * ((l.unit || UNITS_FOR[ing.baseUnit][0]) === 'KG' || (l.unit || UNITS_FOR[ing.baseUnit][0]) === 'L' ? 1 : 0.001))))}/
                  {ing.baseUnit === 'PCS' ? 'pc' : ing.baseUnit === 'G' ? 'kg' : 'L'}
                </p>
              )}
            </div>
          );
        })}
        <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, { ...blank }])}>
          + Line
        </Button>
        <TextArea label="Notes" value={head.notes} onChange={(e) => setHead((h) => ({ ...h, notes: e.target.value }))} />
        <p className="text-xs text-faint">Purchases are stock, not expenses — their cost reaches profit reports as ingredient cost when sold. Record untracked items (e.g. gas, ice) as expenses.</p>
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}

function Suppliers() {
  const toast = useToast();
  const [rows, setRows] = useState<Supplier[] | null>(null);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [form, setForm] = useState({ name: '', contact: '', phone: '', notes: '', isActive: true });
  const load = useCallback(() => {
    api.get<Supplier[]>('/suppliers').then(setRows, (e) => toast(errorMessage(e), 'bad'));
  }, [toast]);
  useEffect(load, [load]);
  useEffect(() => {
    const s = editing && editing !== 'new' ? editing : null;
    setForm({ name: s?.name ?? '', contact: s?.contact ?? '', phone: s?.phone ?? '', notes: s?.notes ?? '', isActive: s?.isActive ?? true });
  }, [editing]);
  async function save() {
    try {
      const body = { ...form, contact: form.contact || null, phone: form.phone || null, notes: form.notes || null };
      if (editing && editing !== 'new') await api.patch(`/suppliers/${editing.id}`, body);
      else await api.post('/suppliers', body);
      toast('Supplier saved', 'ok');
      setEditing(null);
      load();
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  }
  return (
    <div className="space-y-4">
      <Button onClick={() => setEditing('new')}>+ Supplier</Button>
      {!rows ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <EmptyState title="No suppliers yet" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((s) => (
            <Card key={s.id} className="hover-lift p-4">
              <div className="flex justify-between">
                <p className="font-heading font-semibold">{s.name}</p>
                {!s.isActive && <Badge>Inactive</Badge>}
              </div>
              <p className="text-sm text-muted">{[s.contact, s.phone].filter(Boolean).join(' · ') || 'No contact details'}</p>
              {s.notes && <p className="mt-1 text-xs text-faint">{s.notes}</p>}
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setEditing(s)}>
                Edit
              </Button>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New supplier' : 'Edit supplier'} footer={<Button onClick={save}>Save</Button>}>
        <div className="space-y-3">
          <Field label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
          <Field label="Contact person" value={form.contact} onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))} />
          <Field label="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          <TextArea label="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          {editing !== 'new' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-pink-500" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
              Active
            </label>
          )}
        </div>
      </Modal>
    </div>
  );
}
