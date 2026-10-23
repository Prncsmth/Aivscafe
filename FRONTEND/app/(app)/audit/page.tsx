'use client';

import { useEffect, useState } from 'react';
import { errorMessage, qs, request } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, PageHeader, SelectField, Skeleton, Table } from '@/components/ui';
import { NeedsOnline, OwnerOnly } from '@/components/app-shell';

interface Log {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: unknown;
  createdAt: string;
  user: { name: string } | null;
}

const ACTION_TONE = (a: string): 'bad' | 'warn' | 'ok' | 'lilac' | 'muted' =>
  /FAILED|VOID|CANCEL|DELETED|NEGATIVE|OVERRIDE/.test(a) ? 'bad' : /PRICE|ADJUSTED|WASTE|SETTINGS|USER_/.test(a) ? 'warn' : /SYNC|CONFLICT/.test(a) ? 'lilac' : /CREATED|OPENED|LOGIN|RECORDED|VERIFIED/.test(a) ? 'ok' : 'muted';

export default function AuditPage() {
  const [f, setF] = useState({ entity: '', action: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Log[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    request<Log[]>(`/audit-logs${qs({ ...f, from: f.from && f.to ? f.from : undefined, to: f.from && f.to ? f.to : undefined, page, pageSize: 50 })}`).then(
      (r) => {
        setRows(r.data);
        setTotal(Number(r.meta?.total ?? 0));
      },
      (e) => setError(errorMessage(e)),
    );
  }, [f, page]);

  return (
    <OwnerOnly>
      <NeedsOnline>
        <PageHeader eyebrow="Admin" title="Audit Log" subtitle="Every sensitive action — price changes, cancellations, stock adjustments, overrides, logins — is recorded here and cannot be edited." />
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <SelectField label="Area" value={f.entity} onChange={(e) => (setPage(1), setF((x) => ({ ...x, entity: e.target.value })))}>
            <option value="">All</option>
            {['Order', 'Payment', 'ProductVariant', 'Product', 'Ingredient', 'Purchase', 'CashShift', 'Expense', 'User', 'SyncConflict', 'Setting'].map((e) => (
              <option key={e}>{e}</option>
            ))}
          </SelectField>
          <Field label="Action (exact)" value={f.action} placeholder="PRICE_CHANGED" onChange={(e) => (setPage(1), setF((x) => ({ ...x, action: e.target.value.toUpperCase() })))} />
          <Field label="From" type="date" value={f.from} onChange={(e) => (setPage(1), setF((x) => ({ ...x, from: e.target.value })))} />
          <Field label="To" type="date" value={f.to} onChange={(e) => (setPage(1), setF((x) => ({ ...x, to: e.target.value })))} />
        </div>
        <ErrorNote>{error}</ErrorNote>
        <Card className="p-2">
          {!rows ? (
            <Skeleton className="h-64" />
          ) : rows.length === 0 ? (
            <EmptyState title="Nothing logged for these filters" />
          ) : (
            <Table head={['When', 'Who', 'Action', 'Area', 'Details']}>
              {rows.map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-muted">{fmtDateTime(l.createdAt)}</td>
                  <td className="px-3 py-2">{l.user?.name ?? <span className="text-faint">system</span>}</td>
                  <td className="px-3 py-2">
                    <Badge tone={ACTION_TONE(l.action)}>{l.action.replace(/_/g, ' ').toLowerCase()}</Badge>
                  </td>
                  <td className="px-3 py-2 text-muted">{l.entity}</td>
                  <td className="max-w-md px-3 py-2 text-xs">
                    {l.details ? (
                      <button className="text-left text-brand" onClick={() => setOpen(open === l.id ? null : l.id)}>
                        {open === l.id ? 'Hide' : 'Show'}
                      </button>
                    ) : (
                      '—'
                    )}
                    {open === l.id && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-faint">{JSON.stringify(l.details, null, 1)}</pre>}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <div className="mt-3 flex items-center justify-between text-sm text-muted">
          <span>{total} entries</span>
          <span className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Prev
            </Button>
            <Button size="sm" variant="secondary" disabled={page * 50 >= total} onClick={() => setPage((p) => p + 1)}>
              Next →
            </Button>
          </span>
        </div>
      </NeedsOnline>
    </OwnerOnly>
  );
}
