'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePos } from '@/lib/offline/pos-context';
import { peso } from '@/lib/money';
import { fmtDateTime } from '@/lib/format';
import type { ShiftSummary } from '@/lib/types';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorNote, Field, MoneyField, PageHeader, SelectField, Skeleton, Stat, Table, TextArea } from '@/components/ui';
import { NeedsOnline } from '@/components/app-shell';
import { Icon } from '@/components/icons';
import { useToast } from '@/components/toast';

export default function ShiftPage() {
  const { user } = useAuth();
  return (
    <NeedsOnline>
      <PageHeader eyebrow="Daily operations" title="Shift & Cash" subtitle="Open your shift with the starting cash, record cash in/out, and count the drawer when you close." />
      <MyShift />
      {user?.role === 'OWNER' && <ShiftReviews />}
    </NeedsOnline>
  );
}

function MyShift() {
  const { refreshShift, unsyncedCount } = usePos();
  const toast = useToast();
  const [summary, setSummary] = useState<ShiftSummary | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [start, setStart] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [move, setMove] = useState<{ type: 'CASH_IN' | 'CASH_OUT'; amount: number | null; reason: string }>({ type: 'CASH_OUT', amount: null, reason: '' });
  const [counted, setCounted] = useState<number | null>(null);
  const [gcashReported, setGcashReported] = useState<number | null>(null);
  const [closeNotes, setCloseNotes] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [closed, setClosed] = useState<ShiftSummary | null>(null);

  const load = useCallback(async () => {
    try {
      setSummary(await refreshShift());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [refreshShift]);
  useEffect(() => void load(), [load]);

  async function open() {
    if (start == null) return setError('Enter the starting cash (₱0 is fine).');
    setBusy(true);
    setError('');
    try {
      await api.post('/shifts/open', { startingCashCentavos: start });
      toast('Shift opened', 'ok');
      setClosed(null);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function addMove() {
    if (!move.amount || move.reason.trim().length < 3) return setError('Enter an amount and a reason.');
    setBusy(true);
    setError('');
    try {
      await api.post('/shifts/current/cash-movements', { type: move.type, amountCentavos: move.amount, reason: move.reason });
      toast(move.type === 'CASH_IN' ? 'Cash in recorded' : 'Cash out recorded', 'ok');
      setMove({ type: 'CASH_OUT', amount: null, reason: '' });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!summary || counted == null) return;
    setBusy(true);
    try {
      const res = await api.post<ShiftSummary>(`/shifts/${summary.shift.id}/close`, {
        countedCashCentavos: counted,
        reportedGcashCentavos: gcashReported,
        notes: closeNotes || null,
      });
      setClosed(res);
      setConfirmClose(false);
      setCounted(null);
      setGcashReported(null);
      await load();
      toast('Shift closed', 'ok');
    } catch (e) {
      setError(errorMessage(e));
      setConfirmClose(false);
    } finally {
      setBusy(false);
    }
  }

  if (summary === undefined) return <Skeleton className="h-64" />;

  if (!summary) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="animate-rise space-y-4 p-6">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <Icon name="wallet" className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-2xl font-bold">Open a shift</h2>
              <p className="text-sm text-muted">Count the cash in the drawer before the first sale.</p>
            </div>
          </div>
          <MoneyField label="Starting cash" value={start} onChange={setStart} autoFocus />
          <ErrorNote>{error}</ErrorNote>
          <Button size="lg" className="w-full" loading={busy} onClick={open}>
            Open shift
          </Button>
        </Card>
        {closed && <ClosedSummary s={closed} />}
      </div>
    );
  }

  const variance = counted != null ? counted - summary.expectedCashCentavos : null;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Expected cash in drawer" value={peso(summary.expectedCashCentavos)} hint={`Start ${peso(summary.shift.startingCashCentavos)}`} />
        <Stat label="Cash sales" value={peso(summary.cashPaymentsCentavos - summary.cashRefundsCentavos)} hint={summary.cashRefundsCentavos ? `Refunds ${peso(summary.cashRefundsCentavos)}` : undefined} delay={60} />
        <Stat
          label="GCash (not cash)"
          value={peso(summary.expectedGcashCentavos)}
          hint={summary.gcashUnverifiedCentavos ? `${peso(summary.gcashUnverifiedCentavos)} unverified` : 'All verified'}
          tone={summary.gcashUnverifiedCentavos ? 'warn' : undefined}
          delay={120}
        />
        <Stat label="Total sales" value={peso(summary.totalSalesCentavos)} hint={`${summary.orderCount} orders · ${summary.openOrderCount} still open`} delay={180} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="animate-rise space-y-4 p-5">
          <h2 className="text-xl font-bold">Cash in / cash out</h2>
          <p className="text-sm text-muted">Money taken from or added to the drawer that is not a sale (buying ice, adding change, etc.).</p>
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Type" value={move.type} onChange={(e) => setMove((m) => ({ ...m, type: e.target.value as 'CASH_IN' | 'CASH_OUT' }))}>
              <option value="CASH_OUT">Cash out</option>
              <option value="CASH_IN">Cash in</option>
            </SelectField>
            <MoneyField label="Amount" value={move.amount} onChange={(v) => setMove((m) => ({ ...m, amount: v }))} />
          </div>
          <Field label="Reason" value={move.reason} onChange={(e) => setMove((m) => ({ ...m, reason: e.target.value }))} placeholder="Bought ice / added coins" />
          <Button variant="secondary" loading={busy} onClick={addMove}>
            Record
          </Button>
          <p className="text-xs text-muted">
            So far: in {peso(summary.cashInCentavos)} · out {peso(summary.cashOutCentavos)}
          </p>
        </Card>

        <Card className="animate-rise space-y-4 p-5 [animation-delay:80ms]">
          <h2 className="text-xl font-bold">Close shift</h2>
          <p className="text-sm text-muted">Opened {fmtDateTime(summary.shift.openedAt)}. Count every peso in the drawer.</p>
          {unsyncedCount > 0 && (
            <p className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
              {unsyncedCount} offline order(s) on this device are not synced yet. Sync them first so the totals are complete.
            </p>
          )}
          <MoneyField label="Cash counted" value={counted} onChange={setCounted} />
          <MoneyField label="GCash total shown in the app (optional)" value={gcashReported} onChange={setGcashReported} hint={`System expects ${peso(summary.expectedGcashCentavos)}`} />
          {variance != null && (
            <div className={`animate-pop rounded-2xl p-3 font-heading text-lg font-bold ${variance === 0 ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'}`}>
              {variance === 0 ? 'Drawer balanced ✓' : variance > 0 ? `Over by ${peso(variance)}` : `Short by ${peso(-variance)}`}
            </div>
          )}
          <TextArea label="Notes" value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} />
          <ErrorNote>{error}</ErrorNote>
          <Button size="lg" className="w-full" disabled={counted == null} onClick={() => setConfirmClose(true)}>
            Close shift
          </Button>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmClose}
        title="Close this shift?"
        loading={busy}
        confirmLabel="Close shift"
        onClose={() => setConfirmClose(false)}
        onConfirm={close}
        message={
          <>
            Expected cash <strong className="text-ink">{peso(summary.expectedCashCentavos)}</strong>, counted <strong className="text-ink">{peso(counted ?? 0)}</strong>.
            {unsyncedCount > 0 && ' Offline orders not yet synced will be flagged for the owner.'} Large differences are sent to the owner for review.
          </>
        }
      />
    </div>
  );
}

function ClosedSummary({ s }: { s: ShiftSummary }) {
  return (
    <Card className="animate-rise space-y-2 p-6">
      <h2 className="text-xl font-bold">Last shift summary</h2>
      <Row l="Expected cash" v={peso(s.expectedCashCentavos)} />
      <Row l="Counted cash" v={peso(s.shift.countedCashCentavos ?? 0)} />
      <Row l="Difference" v={peso(s.shift.cashVarianceCentavos ?? 0)} />
      <Row l="GCash (system)" v={peso(s.expectedGcashCentavos)} />
      <Row l="Total sales" v={peso(s.totalSalesCentavos)} />
      {s.shift.reviewStatus === 'PENDING_REVIEW' && <Badge tone="warn">Sent to owner for review</Badge>}
    </Card>
  );
}

const Row = ({ l, v }: { l: string; v: string }) => (
  <div className="flex justify-between text-sm">
    <span className="text-muted">{l}</span>
    <span className="tabular font-semibold">{v}</span>
  </div>
);

interface ShiftRow {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  expectedCashCentavos: number | null;
  countedCashCentavos: number | null;
  cashVarianceCentavos: number | null;
  expectedGcashCentavos: number | null;
  reportedGcashCentavos: number | null;
  reviewStatus: string;
  reviewNote: string | null;
  notes: string | null;
  user: { name: string };
}

function ShiftReviews() {
  const toast = useToast();
  const [filter, setFilter] = useState('PENDING_REVIEW');
  const [rows, setRows] = useState<ShiftRow[] | null>(null);
  const [reviewing, setReviewing] = useState<ShiftRow | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    api.get<ShiftRow[]>(`/shifts${qs({ reviewStatus: filter || undefined, pageSize: 50 })}`).then(setRows, (e) => toast(errorMessage(e), 'bad'));
  }, [filter, toast]);
  useEffect(load, [load]);

  async function review() {
    if (!reviewing) return;
    try {
      await api.post(`/shifts/${reviewing.id}/review`, { note });
      toast('Shift marked as reviewed', 'ok');
      setReviewing(null);
      setNote('');
      load();
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  }

  return (
    <Card className="mt-8 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">All shifts (owner)</h2>
        <SelectField label="Show" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="PENDING_REVIEW">Needs review</option>
          <option value="">All</option>
          <option value="REVIEWED">Reviewed</option>
        </SelectField>
      </div>
      {!rows ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <EmptyState title="No shifts to show">Shifts with cash or GCash differences above your threshold appear here.</EmptyState>
      ) : (
        <Table head={['Cashier', 'Opened', 'Closed', 'Expected', 'Counted', 'Difference', 'GCash sys / app', 'Review']}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2.5 font-semibold">{r.user.name}</td>
              <td className="px-3 py-2.5 text-muted">{fmtDateTime(r.openedAt)}</td>
              <td className="px-3 py-2.5 text-muted">{r.closedAt ? fmtDateTime(r.closedAt) : <Badge tone="pink">Open</Badge>}</td>
              <td className="tabular px-3 py-2.5">{r.expectedCashCentavos != null ? peso(r.expectedCashCentavos) : '—'}</td>
              <td className="tabular px-3 py-2.5">{r.countedCashCentavos != null ? peso(r.countedCashCentavos) : '—'}</td>
              <td className={`tabular px-3 py-2.5 font-semibold ${r.cashVarianceCentavos ? 'text-bad' : 'text-ok'}`}>{r.cashVarianceCentavos != null ? peso(r.cashVarianceCentavos) : '—'}</td>
              <td className="tabular px-3 py-2.5 text-muted">
                {r.expectedGcashCentavos != null ? peso(r.expectedGcashCentavos) : '—'} / {r.reportedGcashCentavos != null ? peso(r.reportedGcashCentavos) : '—'}
              </td>
              <td className="px-3 py-2.5">
                {r.reviewStatus === 'PENDING_REVIEW' ? (
                  <Button size="sm" onClick={() => setReviewing(r)}>
                    Review
                  </Button>
                ) : r.reviewStatus === 'REVIEWED' ? (
                  <span className="text-xs text-muted" title={r.reviewNote ?? ''}>
                    ✓ {r.reviewNote}
                  </span>
                ) : (
                  <span className="text-xs text-faint">—</span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <ConfirmDialog
        open={!!reviewing}
        title="Mark shift reviewed"
        confirmLabel="Save review"
        onClose={() => setReviewing(null)}
        onConfirm={() => (note.trim().length >= 3 ? void review() : toast('Write a short note', 'warn'))}
        message={reviewing?.notes ? `Cashier note: “${reviewing.notes}”` : 'Write what you found (e.g. counted again, change given wrong).'}
      >
        <Field label="Review note" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
      </ConfirmDialog>
    </Card>
  );
}
