'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePos } from '@/lib/offline/pos-context';
import type { OutboxRecord } from '@/lib/offline/db';
import { peso } from '@/lib/money';
import { fmtDateTime } from '@/lib/format';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, PageHeader, Skeleton, Stat, Tabs } from '@/components/ui';
import { ReceiptModal, offlineToReceipt, type ReceiptData } from '@/components/receipt';
import { useToast } from '@/components/toast';

const STATUS: Record<OutboxRecord['status'], { label: string; tone: 'warn' | 'lilac' | 'ok' | 'bad' }> = {
  PENDING: { label: 'Pending sync', tone: 'warn' },
  SYNCING: { label: 'Syncing…', tone: 'lilac' },
  SYNCED: { label: 'Synced', tone: 'ok' },
  FAILED: { label: 'Sync failed', tone: 'bad' },
};

const CONFLICT_TEXT: Record<string, string> = {
  PRICE_MISMATCH: 'Sold at an older price',
  CATALOG_OUTDATED: 'Menu was outdated',
  INSUFFICIENT_STOCK: 'Stock went below zero',
  PRODUCT_UNAVAILABLE: 'Item was unavailable',
  DISCOUNT_LIMIT: 'Discount above cashier limit',
  SHIFT_CLOSED: 'Shift already closed',
};

export default function SyncPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'device' | 'conflicts'>('device');
  return (
    <>
      <PageHeader
        eyebrow="Daily operations"
        title="Sync"
        subtitle="Orders saved while offline live on this device until the server confirms them. Nothing is deleted before that."
        actions={
          user?.role === 'OWNER' ? (
            <Tabs value={tab} onChange={setTab} options={[{ value: 'device', label: 'This device' }, { value: 'conflicts', label: 'Conflicts to review' }]} />
          ) : undefined
        }
      />
      {tab === 'device' ? <DeviceOutbox /> : <Conflicts />}
    </>
  );
}

function DeviceOutbox() {
  const { records, online, syncing, syncNow, unsyncedCount, lastSync } = usePos();
  const { user } = useAuth();
  const toast = useToast();
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const now = Date.now();

  async function retry() {
    const r = await syncNow(true);
    if (!r) return toast(online ? 'Could not sync right now' : 'Still offline', 'warn');
    if (r.networkError) toast('Server not reachable — will retry automatically', 'warn');
    else toast(`Synced ${r.synced}, failed ${r.failed}`, r.failed ? 'warn' : 'ok');
  }

  const counts = {
    pending: records.filter((r) => r.status === 'PENDING' || r.status === 'SYNCING').length,
    failed: records.filter((r) => r.status === 'FAILED').length,
    synced: records.filter((r) => r.status === 'SYNCED').length,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Connection" value={online ? 'Online' : 'Offline'} tone={online ? 'ok' : 'warn'} />
        <Stat label="Waiting to sync" value={counts.pending} tone={counts.pending ? 'warn' : undefined} delay={60} />
        <Stat label="Failed" value={counts.failed} tone={counts.failed ? 'bad' : undefined} delay={120} />
        <Stat label="Synced (last 7 days)" value={counts.synced} delay={180} hint={lastSync ? `Last run ${fmtDateTime(lastSync.at)}` : undefined} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={retry} loading={syncing} disabled={!online || !unsyncedCount}>
          Retry sync now
        </Button>
        <p className="text-sm text-muted">Sync runs automatically every few seconds while online.</p>
      </div>
      <Card className="p-4">
        {records.length === 0 ? (
          <EmptyState title="No offline orders on this device">When the internet drops, orders you take on the POS show up here until they sync.</EmptyState>
        ) : (
          <ul className="divide-y divide-line/60">
            {records.map((r) => (
              <li key={r.clientId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-heading font-semibold">
                    {r.serverReference ?? r.payload.tempReference}
                    {r.serverReference && <span className="ml-2 text-xs text-muted">(was {r.payload.tempReference})</span>}
                  </p>
                  <p className="text-xs text-muted">
                    {fmtDateTime(r.payload.clientCreatedAt)} · {r.payload.items.reduce((s, i) => s + i.quantity, 0)} items · {peso(r.payload.totalCentavos)}
                    {r.payload.payments.some((p) => p.method === 'GCASH') && ' · GCash unverified'}
                  </p>
                  {r.lastError && r.status === 'FAILED' && (
                    <p className="text-xs text-bad">
                      {r.lastError.message}
                      {r.retryable ? (r.nextAttemptAt > now ? ` · retrying ${fmtDateTime(r.nextAttemptAt)}` : ' · retrying soon') : ' · needs attention, then tap Retry'}
                    </p>
                  )}
                  {r.conflicts.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {r.conflicts.map((c) => (
                        <Badge key={c} tone="warn">
                          {CONFLICT_TEXT[c] ?? c}
                        </Badge>
                      ))}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => setReceipt(offlineToReceipt(r.payload, user?.name))}>
                    Receipt
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />
      <p className="text-xs text-faint">
        Each device keeps its own offline orders. Two devices that are both offline do not see each other&apos;s orders or stock until they sync.
      </p>
    </div>
  );
}

interface Conflict {
  id: string;
  type: string;
  status: 'OPEN' | 'RESOLVED';
  details: Record<string, unknown>;
  createdAt: string;
  resolution: string | null;
  resolvedBy: { name: string } | null;
  order: { id: string; reference: string; tempReference: string | null; totalCentavos: number; createdAt: string; cashier: { name: string } };
}

function Conflicts() {
  const { online } = usePos();
  const toast = useToast();
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [rows, setRows] = useState<Conflict[] | null>(null);
  const [resolving, setResolving] = useState<Conflict | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    if (!online) return;
    api.get<Conflict[]>(`/sync/conflicts${qs({ status, pageSize: 100 })}`).then(setRows, (e) => toast(errorMessage(e), 'bad'));
  }, [status, online, toast]);
  useEffect(load, [load]);

  async function resolve() {
    if (!resolving) return;
    try {
      await api.post(`/sync/conflicts/${resolving.id}/resolve`, { resolution: note });
      toast('Marked as resolved', 'ok');
      setResolving(null);
      setNote('');
      load();
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  }

  if (!online) return <EmptyState title="Conflicts need the internet">Connect to review synced orders.</EmptyState>;
  return (
    <Card className="p-4">
      <Tabs className="mb-4 w-fit" value={status} onChange={setStatus} options={[{ value: 'OPEN', label: 'Open' }, { value: 'RESOLVED', label: 'Resolved' }]} />
      {!rows ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <EmptyState title={status === 'OPEN' ? 'Nothing to review ' : 'No resolved conflicts yet'} />
      ) : (
        <ul className="space-y-3">
          {rows.map((c) => (
            <li key={c.id} className="rounded-2xl border border-line bg-canvas/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-heading font-semibold">
                  <Badge tone="warn">{CONFLICT_TEXT[c.type] ?? c.type}</Badge> <span className="ml-1">{c.order.reference}</span>
                  {c.order.tempReference && <span className="text-xs text-muted"> (offline {c.order.tempReference})</span>}
                </p>
                <span className="text-xs text-muted">
                  {fmtDateTime(c.order.createdAt)} · {c.order.cashier.name} · {peso(c.order.totalCentavos)}
                </span>
              </div>
              <ConflictDetails c={c} />
              {c.status === 'OPEN' ? (
                <Button size="sm" className="mt-3" onClick={() => setResolving(c)}>
                  Resolve
                </Button>
              ) : (
                <p className="mt-2 text-xs text-muted">
                  ✓ {c.resolution} — {c.resolvedBy?.name}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!resolving}
        title="Resolve conflict"
        confirmLabel="Mark resolved"
        onClose={() => setResolving(null)}
        onConfirm={() => (note.trim().length >= 3 ? void resolve() : toast('Write what you did', 'warn'))}
        message="Record what you decided, e.g. “accepted old price”, “did a stock count”, “discount approved”. The order itself is kept exactly as it was sold."
      >
        <Field label="Resolution" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
      </ConfirmDialog>
    </Card>
  );
}

function ConflictDetails({ c }: { c: Conflict }) {
  const d = c.details as Record<string, unknown>;
  if (c.type === 'PRICE_MISMATCH' && Array.isArray(d.items)) {
    return (
      <ul className="mt-2 text-sm text-muted">
        {(d.items as { item: string; chargedUnitCentavos: number; currentUnitCentavos: number }[]).map((i) => (
          <li key={i.item}>
            {i.item}: charged {peso(i.chargedUnitCentavos)}, menu now {peso(i.currentUnitCentavos)}
          </li>
        ))}
      </ul>
    );
  }
  if (c.type === 'INSUFFICIENT_STOCK' && Array.isArray(d.shortages)) {
    return (
      <ul className="mt-2 text-sm text-muted">
        {(d.shortages as { name: string; required: string; available: string; baseUnit: string }[]).map((s) => (
          <li key={s.name}>
            {s.name}: used {Number(s.required)} {s.baseUnit.toLowerCase()}, only {Number(s.available)} recorded — do a stock count
          </li>
        ))}
      </ul>
    );
  }
  return <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap text-faint">{JSON.stringify(d, null, 1)}</pre>;
}
