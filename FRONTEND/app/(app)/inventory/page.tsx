'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, qs, request } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { peso } from '@/lib/money';
import { fmtDate, fmtDateTime, qty } from '@/lib/format';
import type { BaseUnit, Ingredient, Unit } from '@/lib/types';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, MoneyField, PageHeader, SelectField, Skeleton, Stat, Table, Tabs } from '@/components/ui';
import { NeedsOnline } from '@/components/app-shell';
import { useToast } from '@/components/toast';

const UNITS_FOR: Record<BaseUnit, Unit[]> = { G: ['G', 'KG'], ML: ['ML', 'L'], PCS: ['PCS'] };

export default function InventoryPage() {
  const { user } = useAuth();
  const owner = user?.role === 'OWNER';
  const [tab, setTab] = useState<'stock' | 'expiring' | 'movements' | 'valuation'>('stock');
  return (
    <NeedsOnline>
      <PageHeader
        eyebrow="Stock"
        title="Inventory"
        subtitle="Ingredients and supplies are deducted automatically from recipes when orders are placed."
        actions={
          <Tabs
            value={tab}
            onChange={setTab}
            options={[
              { value: 'stock', label: 'Stock' },
              { value: 'expiring', label: 'Expiring' },
              ...(owner
                ? [
                    { value: 'movements' as const, label: 'Movements' },
                    { value: 'valuation' as const, label: 'Valuation' },
                  ]
                : []),
            ]}
          />
        }
      />
      {tab === 'stock' && <StockTab owner={owner} />}
      {tab === 'expiring' && <ExpiringTab />}
      {tab === 'movements' && owner && <MovementsTab />}
      {tab === 'valuation' && owner && <ValuationTab />}
    </NeedsOnline>
  );
}

function StockTab({ owner }: { owner: boolean }) {
  const toast = useToast();
  const [rows, setRows] = useState<Ingredient[] | null>(null);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState<{ kind: 'waste' | 'adjust' | 'edit' | 'new'; ing?: Ingredient } | null>(null);

  const load = useCallback(() => {
    api.get<Ingredient[]>(`/ingredients${qs({ includeInactive: owner ? 'true' : undefined })}`).then(setRows, (e) => toast(errorMessage(e), 'bad'));
  }, [owner, toast]);
  useEffect(load, [load]);

  const list = (rows ?? []).filter((r) => r.name.toLowerCase().includes(search.toLowerCase()));
  const low = (rows ?? []).filter((r) => r.level !== 'OK' && r.isActive).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search" className="min-w-[220px] flex-1" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cups, pearls, octopus…" />
        {low > 0 && <Badge tone="warn">{low} low or out</Badge>}
        {owner && <Button onClick={() => setAction({ kind: 'new' })}>+ New ingredient</Button>}
      </div>
      <Card className="p-2">
        {!rows ? (
          <Skeleton className="h-64" />
        ) : list.length === 0 ? (
          <EmptyState title="No ingredients yet">{owner ? 'Add cups, lids, powders and other supplies to start tracking stock.' : 'The owner has not added ingredients yet.'}</EmptyState>
        ) : (
          <Table head={['Ingredient', 'In stock', 'Low at', 'Status', ...(owner ? ['Avg cost'] : []), '']}>
            {list.map((i) => (
              <tr key={i.id} className={i.isActive ? '' : 'opacity-50'}>
                <td className="px-3 py-2.5 font-semibold">{i.name}</td>
                <td className={`tabular px-3 py-2.5 ${Number(i.stockQty) < 0 ? 'text-bad' : ''}`}>{qty(i.stockQty, i.baseUnit)}</td>
                <td className="tabular px-3 py-2.5 text-muted">{qty(i.lowStockThreshold, i.baseUnit)}</td>
                <td className="px-3 py-2.5">
                  {!i.isActive ? <Badge>Archived</Badge> : <Badge tone={i.level === 'OK' ? 'ok' : i.level === 'LOW' ? 'warn' : 'bad'}>{i.level === 'OK' ? 'OK' : i.level === 'LOW' ? 'Low' : 'Out'}</Badge>}
                </td>
                {owner && <td className="tabular px-3 py-2.5 text-muted">{i.avgUnitCost ? `${peso(Math.round(Number(i.avgUnitCost) * (i.baseUnit === 'PCS' ? 1 : 1000)))}/${i.baseUnit === 'PCS' ? 'pc' : i.baseUnit === 'G' ? 'kg' : 'L'}` : '—'}</td>}
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'waste', ing: i })}>
                    Waste
                  </Button>
                  {owner && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'adjust', ing: i })}>
                        Count
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'edit', ing: i })}>
                        Edit
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {owner && <p className="text-xs text-faint">To receive new stock, record a purchase on the Purchases page — it updates stock, cost and expiry batches together.</p>}
      <IngredientAction action={action} onClose={() => setAction(null)} onDone={load} />
    </div>
  );
}

function IngredientAction({ action, onClose, onDone }: { action: { kind: 'waste' | 'adjust' | 'edit' | 'new'; ing?: Ingredient } | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ quantity: '', unit: '' as Unit | '', reason: '', name: '', baseUnit: 'G' as BaseUnit, threshold: '', openingQty: '', openingUnit: 'G' as Unit, openingCost: null as number | null, expiry: '', isActive: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ing = action?.ing;

  useEffect(() => {
    if (!action) return;
    setError('');
    setForm({
      quantity: action.kind === 'adjust' && ing ? String(Number(ing.stockQty)) : '',
      unit: ing?.baseUnit ?? '',
      reason: '',
      name: ing?.name ?? '',
      baseUnit: ing?.baseUnit ?? 'G',
      threshold: ing ? String(Number(ing.lowStockThreshold)) : '',
      openingQty: '',
      openingUnit: 'G',
      openingCost: null,
      expiry: '',
      isActive: ing?.isActive ?? true,
    });
  }, [action, ing]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (action?.kind === 'waste' && ing) {
        await api.post(`/ingredients/${ing.id}/waste`, { quantity: form.quantity, unit: form.unit || ing.baseUnit, reason: form.reason });
        toast('Waste recorded', 'ok');
      } else if (action?.kind === 'adjust' && ing) {
        await api.post(`/ingredients/${ing.id}/adjust`, { countedQuantity: form.quantity, unit: form.unit || ing.baseUnit, reason: form.reason });
        toast('Stock count saved', 'ok');
      } else if (action?.kind === 'edit' && ing) {
        await api.patch(`/ingredients/${ing.id}`, { name: form.name, lowStockThreshold: form.threshold || '0', isActive: form.isActive });
        toast('Ingredient updated', 'ok');
      } else if (action?.kind === 'new') {
        await api.post('/ingredients', {
          name: form.name,
          baseUnit: form.baseUnit,
          lowStockThreshold: form.threshold || '0',
          opening: form.openingQty
            ? { quantity: form.openingQty, unit: form.openingUnit, totalCostCentavos: form.openingCost ?? 0, expiryDate: form.expiry || null }
            : undefined,
        });
        toast('Ingredient added', 'ok');
      }
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const title = { waste: `Record waste · ${ing?.name}`, adjust: `Stock count · ${ing?.name}`, edit: `Edit · ${ing?.name}`, new: 'New ingredient' }[action?.kind ?? 'new'];
  return (
    <Modal open={!!action} onClose={onClose} title={title} footer={<Button loading={busy} onClick={submit}>Save</Button>}>
      <div className="space-y-4">
        {(action?.kind === 'waste' || action?.kind === 'adjust') && ing && (
          <>
            <p className="text-sm text-muted">
              On record: <strong className="text-ink">{qty(ing.stockQty, ing.baseUnit)}</strong>
              {action.kind === 'adjust' && ' — enter what you physically counted.'}
            </p>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Field label={action.kind === 'waste' ? 'Quantity wasted' : 'Counted quantity'} inputMode="decimal" value={form.quantity} onChange={set('quantity')} autoFocus />
              <SelectField label="Unit" value={form.unit} onChange={set('unit')}>
                {UNITS_FOR[ing.baseUnit].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </SelectField>
            </div>
            <Field label="Reason" value={form.reason} onChange={set('reason')} placeholder={action.kind === 'waste' ? 'Spoiled milk, dropped cups…' : 'Weekly count'} />
          </>
        )}
        {(action?.kind === 'edit' || action?.kind === 'new') && (
          <>
            <Field label="Name" value={form.name} onChange={set('name')} autoFocus />
            <div className="grid grid-cols-2 gap-3">
              <SelectField label="Stored in" value={form.baseUnit} onChange={set('baseUnit')} disabled={action.kind === 'edit'}>
                <option value="G">grams (g)</option>
                <option value="ML">millilitres (ml)</option>
                <option value="PCS">pieces (pcs)</option>
              </SelectField>
              <Field label={`Low-stock level (${form.baseUnit.toLowerCase()})`} inputMode="decimal" value={form.threshold} onChange={set('threshold')} />
            </div>
            {action.kind === 'edit' && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-pink-500" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                Active (uncheck to archive)
              </label>
            )}
            {action.kind === 'new' && (
              <div className="space-y-3 rounded-2xl border border-line p-3">
                <p className="label">Opening stock (optional)</p>
                <div className="grid grid-cols-[1fr_auto] gap-3">
                  <Field label="Quantity" inputMode="decimal" value={form.openingQty} onChange={set('openingQty')} />
                  <SelectField label="Unit" value={form.openingUnit} onChange={set('openingUnit')}>
                    {UNITS_FOR[form.baseUnit].map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </SelectField>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <MoneyField label="Total cost" value={form.openingCost} onChange={(v) => setForm((f) => ({ ...f, openingCost: v }))} hint="Used for profit estimates" />
                  <Field label="Expiry date" type="date" value={form.expiry} onChange={set('expiry')} />
                </div>
              </div>
            )}
          </>
        )}
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}

interface Batch {
  id: string;
  ingredientName: string;
  baseUnit: string;
  batchCode: string | null;
  remainingQty: string;
  expiryDate: string;
  expired: boolean;
}
function ExpiringTab() {
  const [days, setDays] = useState('7');
  const [rows, setRows] = useState<Batch[] | null>(null);
  useEffect(() => {
    setRows(null);
    api.get<Batch[]>(`/inventory/expiring${qs({ days })}`).then(setRows, () => setRows([]));
  }, [days]);
  return (
    <Card className="p-4">
      <SelectField label="Within" className="mb-4 w-48" value={days} onChange={(e) => setDays(e.target.value)}>
        <option value="3">3 days</option>
        <option value="7">7 days</option>
        <option value="14">14 days</option>
        <option value="30">30 days</option>
      </SelectField>
      {!rows ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing expiring">No batches with stock left expire in this window.</EmptyState>
      ) : (
        <Table head={['Ingredient', 'Batch', 'Remaining', 'Expiry', '']}>
          {rows.map((b) => (
            <tr key={b.id}>
              <td className="px-3 py-2.5 font-semibold">{b.ingredientName}</td>
              <td className="px-3 py-2.5 text-muted">{b.batchCode ?? '—'}</td>
              <td className="tabular px-3 py-2.5">{qty(b.remainingQty, b.baseUnit)}</td>
              <td className="px-3 py-2.5">{fmtDate(b.expiryDate)}</td>
              <td className="px-3 py-2.5">
                <Badge tone={b.expired ? 'bad' : 'warn'}>{b.expired ? 'Expired — record as waste' : 'Use soon'}</Badge>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

interface Movement {
  id: string;
  type: string;
  quantity: string;
  valueCentavos: number;
  stockAfter: string;
  reason: string | null;
  createdAt: string;
  ingredient: { name: string; baseUnit: string };
  user: { name: string } | null;
  order: { reference: string } | null;
}
const MOVE_TONE: Record<string, 'ok' | 'bad' | 'warn' | 'lilac' | 'muted' | 'pink'> = { PURCHASE: 'ok', OPENING: 'ok', SALE: 'pink', SALE_REVERSAL: 'lilac', ADJUSTMENT: 'warn', WASTE: 'bad' };

function MovementsTab() {
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Movement[] | null>(null);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    setRows(null);
    request<Movement[]>(`/inventory/movements${qs({ type, page, pageSize: 50 })}`).then((r) => {
      setRows(r.data);
      setTotal(Number(r.meta?.total ?? 0));
    });
  }, [type, page]);
  return (
    <Card className="p-4">
      <SelectField label="Type" className="mb-4 w-56" value={type} onChange={(e) => (setPage(1), setType(e.target.value))}>
        <option value="">All movements</option>
        {['PURCHASE', 'OPENING', 'SALE', 'SALE_REVERSAL', 'ADJUSTMENT', 'WASTE'].map((t) => (
          <option key={t} value={t}>
            {t.replace('_', ' ').toLowerCase()}
          </option>
        ))}
      </SelectField>
      {!rows ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <EmptyState title="No movements yet" />
      ) : (
        <>
          <Table head={['When', 'Ingredient', 'Type', 'Change', 'Value', 'Stock after', 'By / ref']}>
            {rows.map((m) => (
              <tr key={m.id}>
                <td className="px-3 py-2 text-muted">{fmtDateTime(m.createdAt)}</td>
                <td className="px-3 py-2 font-semibold">{m.ingredient.name}</td>
                <td className="px-3 py-2">
                  <Badge tone={MOVE_TONE[m.type]}>{m.type.replace('_', ' ').toLowerCase()}</Badge>
                </td>
                <td className={`tabular px-3 py-2 ${Number(m.quantity) < 0 ? 'text-bad' : 'text-ok'}`}>{(Number(m.quantity) > 0 ? '+' : '') + qty(m.quantity, m.ingredient.baseUnit)}</td>
                <td className="tabular px-3 py-2 text-muted">{peso(m.valueCentavos)}</td>
                <td className="tabular px-3 py-2">{qty(m.stockAfter, m.ingredient.baseUnit)}</td>
                <td className="px-3 py-2 text-xs text-muted">
                  {m.user?.name ?? '—'}
                  {m.order && ` · ${m.order.reference}`}
                  {m.reason && <span className="block">{m.reason}</span>}
                </td>
              </tr>
            ))}
          </Table>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Prev
            </Button>
            <Button size="sm" variant="secondary" disabled={page * 50 >= total} onClick={() => setPage((p) => p + 1)}>
              Next →
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function ValuationTab() {
  const [v, setV] = useState<{ method: string; totalCentavos: number; items: { id: string; name: string; baseUnit: string; stockQty: string; valueCentavos: number }[] } | null>(null);
  useEffect(() => {
    api.get<typeof v>('/inventory/valuation').then(setV);
  }, []);
  if (!v) return <Skeleton className="h-40" />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="Stock value on hand" value={peso(v.totalCentavos)} hint="Weighted-average cost × quantity on record" />
        <Card className="p-4 text-sm text-muted">
          <p className="label">Costing method</p>
          Each purchase updates the ingredient&apos;s weighted-average cost. Sales use that cost for COGS. Negative stock is valued at ₱0.
        </Card>
      </div>
      <Card className="p-2">
        <Table head={['Ingredient', 'On hand', 'Value']}>
          {v.items
            .sort((a, b) => b.valueCentavos - a.valueCentavos)
            .map((i) => (
              <tr key={i.id}>
                <td className="px-3 py-2">{i.name}</td>
                <td className="tabular px-3 py-2 text-muted">{qty(i.stockQty, i.baseUnit)}</td>
                <td className="tabular px-3 py-2">{peso(i.valueCentavos)}</td>
              </tr>
            ))}
        </Table>
      </Card>
    </div>
  );
}

