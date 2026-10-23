'use client';

import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { peso } from '@/lib/money';
import { PAY_LABEL, PAY_TONE, STATUS_LABEL, STATUS_TONE, TYPE_LABEL, actionLabel, flowSteps, fmtDateTime, nextStatus } from '@/lib/format';
import { Icon } from './icons';
import type { Order } from '@/lib/types';
import { Badge, Button, ConfirmDialog, ErrorNote, Field, Modal, MoneyField, Skeleton, cx } from './ui';
import { ReceiptView, orderToReceipt } from './receipt';
import { useToast } from './toast';

export function OrderDetailModal({
  orderId,
  onClose,
  onChanged,
  autoPay,
}: {
  orderId: string | null;
  onClose: () => void;
  onChanged?: (o: Order) => void;
  /** open the payment form as soon as the order loads (from "Collect payment") */
  autoPay?: boolean;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [cancelMode, setCancelMode] = useState<'CANCEL' | 'VOID' | null>(null);
  const [reason, setReason] = useState('');
  const [restore, setRestore] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    setOrder(null);
    setError('');
    setShowReceipt(false);
    api.get<Order>(`/orders/${orderId}`).then(
      (o) => {
        setOrder(o);
        if (autoPay && o.totalCentavos - o.paidCentavos + o.refundedCentavos > 0) setPayOpen(true);
      },
      (e) => setError(errorMessage(e)),
    );
  }, [orderId, autoPay]);

  const update = (o: Order) => {
    setOrder(o);
    onChanged?.(o);
  };

  async function advance() {
    if (!order) return;
    const to = nextStatus(order.status, !!order.delivery);
    if (!to) return;
    setBusy(true);
    try {
      update(await api.post<Order>(`/orders/${order.id}/status`, { to }));
      toast(`Order is now: ${STATUS_LABEL[to]}`, 'ok');
    } catch (e) {
      toast(errorMessage(e), 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!order || !cancelMode) return;
    setBusy(true);
    try {
      update(await api.post<Order>(`/orders/${order.id}/${cancelMode === 'CANCEL' ? 'cancel' : 'void'}`, { reason, restoreInventory: restore || undefined }));
      toast(cancelMode === 'CANCEL' ? 'Order cancelled' : 'Order voided', 'ok');
      setCancelMode(null);
      setReason('');
    } catch (e) {
      toast(errorMessage(e), 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function verify(paymentId: string) {
    try {
      await api.post(`/payments/${paymentId}/verify`, {});
      update(await api.get<Order>(`/orders/${order!.id}`));
      toast('GCash payment verified', 'ok');
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  }

  const next = order ? nextStatus(order.status, !!order.delivery) : null;
  const balance = order ? order.totalCentavos - order.paidCentavos + order.refundedCentavos : 0;
  const closed = order && ['CANCELLED', 'VOIDED'].includes(order.status);
  const finalNext = next === 'COMPLETED' || next === 'DELIVERED';
  const canCancel = order && ['PENDING', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'].includes(order.status) && (order.status === 'PENDING' || user?.role === 'OWNER');
  const canVoid = order && ['COMPLETED', 'DELIVERED'].includes(order.status) && user?.role === 'OWNER';

  return (
    <>
      <Modal
        open={!!orderId}
        onClose={onClose}
        wide
        title={
          order ? (
            <span className="flex flex-wrap items-center gap-2">
              {order.reference}
              <Badge tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Badge>
              <Badge tone={PAY_TONE[order.paymentStatus]}>{PAY_LABEL[order.paymentStatus]}</Badge>
            </span>
          ) : (
            'Order'
          )
        }
        footer={
          order && (
            <div className="flex w-full flex-wrap items-center gap-2">
              {/* Destructive actions sit apart, on the left */}
              {canCancel && (
                <Button variant="danger" size="sm" onClick={() => setCancelMode('CANCEL')}>
                  Cancel order
                </Button>
              )}
              {canVoid && (
                <Button variant="danger" size="sm" onClick={() => setCancelMode('VOID')}>
                  Void order
                </Button>
              )}
              <div className="ml-auto flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setShowReceipt((s) => !s)}>
                  <Icon name="printer" className="h-4 w-4" /> {showReceipt ? 'Hide receipt' : 'Receipt'}
                </Button>
                {!closed && balance > 0 && (
                  <Button variant={finalNext ? 'primary' : 'secondary'} onClick={() => setPayOpen(true)}>
                    <Icon name="cash" className="h-4 w-4" /> Collect payment
                  </Button>
                )}
                {next && !(finalNext && balance > 0) && (
                  <Button loading={busy} onClick={advance}>
                    {actionLabel(next, !!order.delivery)} <Icon name="arrowRight" className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          )
        }
      >
        <ErrorNote>{error}</ErrorNote>
        {!order && !error && <Skeleton className="h-48" />}
        {order && (
          <div className="space-y-5">
            <Progress order={order} />
            {finalNext && balance > 0 && !closed && (
              <p className="rounded-xl border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-warn">Collect the remaining {peso(balance)} before handing over the order.</p>
            )}
            {showReceipt && (
              <div className="space-y-2">
                <ReceiptView r={orderToReceipt(order)} />
                <div className="text-center">
                  <Button variant="secondary" size="sm" onClick={() => window.print()}>
                    Print
                  </Button>
                </div>
              </div>
            )}
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <Info label="Type" value={TYPE_LABEL[order.type]} />
              <Info label="Placed" value={fmtDateTime(order.createdAt)} />
              <Info label="Cashier" value={order.cashier.name} />
              <Info label="Customer" value={order.customerName ?? '—'} />
              {order.source === 'OFFLINE_SYNC' && <Info label="Offline receipt" value={order.tempReference ?? '—'} />}
              {order.notes && <Info label="Note" value={order.notes} />}
            </div>
            {order.delivery && (
              <div className="rounded-2xl border border-line bg-canvas/50 p-3 text-sm">
                <p className="label">Delivery · {order.delivery.areaName}</p>
                <p className="font-semibold">{order.delivery.customerName} · {order.delivery.contactNumber}</p>
                <p className="text-muted">{order.delivery.address}</p>
                {order.delivery.instructions && <p className="text-info">{order.delivery.instructions}</p>}
              </div>
            )}
            {order.conflicts.length > 0 && (
              <div className="rounded-2xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
                Synced from offline with notes for the owner: {order.conflicts.map((c) => c.type.replace(/_/g, ' ').toLowerCase()).join(', ')}
              </div>
            )}
            <div>
              <p className="label">Items</p>
              <ul className="divide-y divide-line/60 rounded-2xl border border-line">
                {order.items.map((i) => (
                  <li key={i.id} className="flex justify-between gap-3 px-3 py-2.5 text-sm">
                    <span>
                      <strong>{i.quantity}×</strong> {i.productName} <span className="text-muted">({i.variantName})</span>
                      {i.modifiers.length > 0 && <span className="block text-xs text-muted">+ {i.modifiers.map((m) => m.name).join(', ')}</span>}
                      {i.notes && <span className="block text-xs text-info italic">“{i.notes}”</span>}
                    </span>
                    <span className="tabular">{peso(i.lineTotalCentavos)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 space-y-1 text-sm">
                <Line label="Subtotal" v={order.subtotalCentavos} />
                {order.discountCentavos > 0 && <Line label={`Discount (${order.discountReason ?? ''})`} v={-order.discountCentavos} />}
                {order.deliveryFeeCentavos > 0 && <Line label="Delivery fee" v={order.deliveryFeeCentavos} />}
                <Line label="Total" v={order.totalCentavos} strong />
                {balance > 0 && !closed && <Line label="Balance due" v={balance} strong />}
              </div>
            </div>
            <div>
              <p className="label">Payments</p>
              {order.payments.length === 0 ? (
                <p className="text-sm text-muted">No payments yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {order.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-canvas/50 px-3 py-2 text-sm">
                      <span className="flex flex-wrap items-center gap-2">
                        {p.kind === 'REFUND' ? <Badge tone="bad">Refund</Badge> : null}
                        {p.method === 'CASH' ? 'Cash' : 'GCash'}
                        {p.reference && <span className="text-xs text-muted">ref {p.reference}</span>}
                        {p.method === 'GCASH' && p.kind === 'PAYMENT' && <Badge tone={p.verification === 'VERIFIED' ? 'ok' : 'warn'}>{p.verification === 'VERIFIED' ? 'Verified' : 'Unverified'}</Badge>}
                        {p.recordedOffline && <Badge tone="lilac">Offline</Badge>}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular font-semibold">{peso(p.amountCentavos)}</span>
                        {p.method === 'GCASH' && p.kind === 'PAYMENT' && p.verification === 'UNVERIFIED' && (
                          <Button size="sm" variant="success" onClick={() => verify(p.id)}>
                            Verify
                          </Button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {order.statusLog && order.statusLog.length > 0 && (
              <div>
                <p className="label">History</p>
                <ol className="space-y-1 border-l border-line pl-4 text-xs text-muted">
                  {order.statusLog.map((s) => (
                    <li key={s.id}>
                      <span className="text-ink">{STATUS_LABEL[s.toStatus]}</span> · {fmtDateTime(s.createdAt)}
                      {s.note && ` — ${s.note}`}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </Modal>

      {order && <PaymentModal open={payOpen} order={order} balance={balance} onClose={() => setPayOpen(false)} onSaved={update} />}

      <ConfirmDialog
        open={!!cancelMode}
        title={cancelMode === 'VOID' ? 'Void completed order?' : 'Cancel order?'}
        danger
        loading={busy}
        confirmLabel={cancelMode === 'VOID' ? 'Void order' : 'Cancel order'}
        onClose={() => setCancelMode(null)}
        onConfirm={() => (reason.trim().length >= 3 ? void cancel() : toast('Write a reason (at least 3 letters)', 'warn'))}
        message={
          <>
            {order?.status === 'PENDING'
              ? 'Ingredients go back to stock automatically because nothing was prepared yet.'
              : 'Ingredients are treated as used unless the owner chooses to restore them.'}{' '}
            Any payments are refunded and recorded on your shift.
          </>
        }
      >
        <Field label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer cancelled, wrong order…" autoFocus />
        {user?.role === 'OWNER' && order?.status !== 'PENDING' && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" className="h-4 w-4 accent-pink-500" checked={restore} onChange={(e) => setRestore(e.target.checked)} />
            Put the ingredients back into stock
          </label>
        )}
      </ConfirmDialog>
    </>
  );
}

function PaymentModal({ open, order, balance, onClose, onSaved }: { open: boolean; order: Order; balance: number; onClose: () => void; onSaved: (o: Order) => void }) {
  const toast = useToast();
  const [method, setMethod] = useState<'CASH' | 'GCASH'>('CASH');
  const [amount, setAmount] = useState<number | null>(balance);
  const [tendered, setTendered] = useState<number | null>(null);
  const [ref, setRef] = useState('');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setAmount(balance);
      setTendered(null);
      setError('');
    }
  }, [open, balance]);

  async function save() {
    if (!amount || amount <= 0) return setError('Enter the amount');
    setBusy(true);
    setError('');
    try {
      const o = await api.post<Order>(`/orders/${order.id}/payments`, {
        method,
        amountCentavos: amount,
        tenderedCentavos: method === 'CASH' ? (tendered ?? amount) : null,
        reference: method === 'GCASH' ? ref || null : null,
        verified: method === 'GCASH' ? verified : undefined,
      });
      onSaved(o);
      toast('Payment recorded', 'ok');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const change = method === 'CASH' && tendered != null && amount != null ? tendered - amount : 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Record payment · ${peso(balance)} due`}
      footer={
        <Button loading={busy} onClick={save}>
          Save payment
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(['CASH', 'GCASH'] as const).map((m) => (
            <Button key={m} variant={method === m ? 'primary' : 'secondary'} onClick={() => setMethod(m)}>
              {m === 'CASH' ? 'Cash' : 'GCash'}
            </Button>
          ))}
        </div>
        <MoneyField label="Amount" value={amount} onChange={setAmount} />
        {method === 'CASH' ? (
          <>
            <MoneyField label="Cash received" value={tendered} onChange={setTendered} />
            {change > 0 && <p className="font-heading text-xl text-ok">Change: {peso(change)}</p>}
          </>
        ) : (
          <>
            <Field label="GCash reference no." value={ref} onChange={(e) => setRef(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-pink-500" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
              I saw this payment in the GCash app
            </label>
          </>
        )}
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p>{value}</p>
    </div>
  );
}

function Line({ label, v, strong }: { label: string; v: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'font-heading text-base font-bold' : 'text-muted'}`}>
      <span>{label}</span>
      <span className="tabular">{peso(v)}</span>
    </div>
  );
}

/** Where the order is in its flow: done steps, the current step, and what comes next. */
function Progress({ order }: { order: Order }) {
  if (order.status === 'CANCELLED' || order.status === 'VOIDED') {
    return (
      <p className="rounded-xl border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">
        {STATUS_LABEL[order.status]}
        {order.cancelReason && ` — ${order.cancelReason}`}
      </p>
    );
  }
  const steps = flowSteps(!!order.delivery);
  const current = steps.indexOf(order.status);
  return (
    <ol className="flex items-center gap-1" aria-label="Order progress">
      {steps.map((s, i) => (
        <li key={s} className="flex min-w-0 flex-1 items-center gap-1" aria-current={i === current ? 'step' : undefined}>
          <span
            className={cx(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
              i < current && 'border-ok bg-ok text-white',
              i === current && 'border-brand bg-brand text-white',
              i > current && 'border-line bg-surface text-faint',
            )}
          >
            {i < current ? <Icon name="check" className="h-4 w-4" /> : i + 1}
          </span>
          <span className={cx('truncate text-xs font-medium', i === current ? 'text-ink' : 'text-muted')}>{STATUS_LABEL[s]}</span>
          {i < steps.length - 1 && <span className={cx('mx-1 h-px flex-1', i < current ? 'bg-ok' : 'bg-line')} />}
        </li>
      ))}
    </ol>
  );
}
