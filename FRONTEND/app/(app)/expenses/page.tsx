'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, qs, request } from '@/lib/api';
import { peso } from '@/lib/money';
import { addDays, fmtDate, manilaDay } from '@/lib/format';
import { Button, Card, ConfirmDialog, EmptyState, ErrorNote, Field, Modal, MoneyField, PageHeader, SelectField, Skeleton, Stat, Table, TextArea } from '@/components/ui';
import { NeedsOnline, OwnerOnly } from '@/components/app-shell';
import { useToast } from '@/components/toast';

const CATS = { INGREDIENTS: 'Ingredients (untracked)', PACKAGING: 'Packaging', TRANSPORTATION: 'Transportation', UTILITIES: 'Utilities', RENT: 'Rent / stall fee', SALARIES: 'Salaries', OTHER: 'Other' } as const;
type Cat = keyof typeof CATS;

interface Expense {
  id: string;
  category: Cat;
  description: string;
  amountCentavos: number;
  incurredAt: string;
  notes: string | null;
  user: { name: string };
}

export default function ExpensesPage() {
  const toast = useToast();
  const today = manilaDay();
  const [range, setRange] = useState({ from: `${today.slice(0, 8)}01`, to: today, category: '' });
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [total, setTotal] = useState(0);
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);

  const load = useCallback(() => {
    setRows(null);
    request<Expense[]>(`/expenses${qs({ ...range, pageSize: 200 })}`).then(
      (r) => {
        setRows(r.data);
        setTotal(Number(r.meta?.totalCentavos ?? 0));
      },
      (e) => toast(errorMessage(e), 'bad'),
    );
  }, [range, toast]);
  useEffect(load, [load]);

  async function remove() {
    if (!deleting) return;
    try {
      await api.del(`/expenses/${deleting.id}`);
      toast('Expense deleted', 'ok');
      setDeleting(null);
      load();
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  }

  return (
    <OwnerOnly>
      <NeedsOnline>
        <PageHeader
          eyebrow="Business"
          title="Expenses"
          subtitle="Rent, utilities, transport and other costs. Ingredient purchases recorded on the Purchases page are not expenses — they become ingredient cost when sold."
          actions={<Button onClick={() => setEditing('new')}>+ Expense</Button>}
        />
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Field label="From" type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          <Field label="To" type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          <SelectField label="Category" value={range.category} onChange={(e) => setRange((r) => ({ ...r, category: e.target.value }))}>
            <option value="">All</option>
            {Object.entries(CATS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </SelectField>
          <Stat label="Total" value={peso(total)} />
        </div>
        <Card className="p-2">
          {!rows ? (
            <Skeleton className="h-48" />
          ) : rows.length === 0 ? (
            <EmptyState title="No expenses in this range" />
          ) : (
            <Table head={['Date', 'Category', 'Description', 'Amount', 'By', '']}>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(x.incurredAt)}</td>
                  <td className="px-3 py-2.5 text-muted">{CATS[x.category]}</td>
                  <td className="px-3 py-2.5">
                    {x.description}
                    {x.notes && <span className="block text-xs text-faint">{x.notes}</span>}
                  </td>
                  <td className="tabular px-3 py-2.5 font-semibold">{peso(x.amountCentavos)}</td>
                  <td className="px-3 py-2.5 text-muted">{x.user.name}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(x)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(x)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <ExpenseModal expense={editing} onClose={() => setEditing(null)} onSaved={load} />
        <ConfirmDialog open={!!deleting} danger title="Delete expense?" confirmLabel="Delete" onClose={() => setDeleting(null)} onConfirm={remove} message={`${deleting?.description} · ${peso(deleting?.amountCentavos ?? 0)}. This is recorded in the audit log.`} />
      </NeedsOnline>
    </OwnerOnly>
  );
}

function ExpenseModal({ expense, onClose, onSaved }: { expense: Expense | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const e0 = expense && expense !== 'new' ? expense : null;
  const [form, setForm] = useState({ category: 'OTHER' as Cat, description: '', amount: null as number | null, date: manilaDay(), notes: '' });
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    setForm({
      category: e0?.category ?? 'UTILITIES',
      description: e0?.description ?? '',
      amount: e0?.amountCentavos ?? null,
      date: e0 ? new Date(e0.incurredAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) : manilaDay(),
      notes: e0?.notes ?? '',
    });
  }, [expense, e0]);
  async function save() {
    if (!form.amount) return setError('Enter the amount');
    try {
      const body = { category: form.category, description: form.description, amountCentavos: form.amount, incurredAt: new Date(`${form.date}T12:00:00+08:00`).toISOString(), notes: form.notes || null };
      if (e0) await api.patch(`/expenses/${e0.id}`, body);
      else await api.post('/expenses', body);
      toast('Expense saved', 'ok');
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Modal open={!!expense} onClose={onClose} title={e0 ? 'Edit expense' : 'New expense'} footer={<Button onClick={save}>Save</Button>}>
      <div className="space-y-3">
        <SelectField label="Category" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as Cat }))}>
          {Object.entries(CATS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
        <Field label="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <MoneyField label="Amount" value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} />
          <Field label="Date" type="date" value={form.date} max={addDays(manilaDay(), 1)} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
        </div>
        <TextArea label="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}
