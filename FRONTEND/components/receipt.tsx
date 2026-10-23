'use client';

import { peso } from '@/lib/money';
import { TYPE_LABEL, fmtDateTime } from '@/lib/format';
import type { Order, OrderType, PaymentMethod } from '@/lib/types';
import type { OfflineOrderPayload } from '@/lib/pos/cart';
import { Badge, Button, Modal } from './ui';

export interface ReceiptData {
  reference: string;
  /** true while the order exists only on this device */
  offline: boolean;
  createdAt: string;
  type: OrderType;
  cashierName?: string;
  customerName?: string | null;
  items: { name: string; variant: string; quantity: number; unitCentavos: number; lineCentavos: number; modifiers: string[]; notes?: string | null }[];
  subtotalCentavos: number;
  discountCentavos: number;
  deliveryFeeCentavos: number;
  totalCentavos: number;
  payments: { method: PaymentMethod; amountCentavos: number; tenderedCentavos?: number | null; changeCentavos?: number | null; verified: boolean }[];
  delivery?: { address: string; contactNumber: string; areaName: string } | null;
}

export function orderToReceipt(o: Order): ReceiptData {
  return {
    reference: o.reference,
    offline: false,
    createdAt: o.createdAt,
    type: o.type,
    cashierName: o.cashier?.name,
    customerName: o.customerName,
    items: o.items.map((i) => ({
      name: i.productName,
      variant: i.variantName,
      quantity: i.quantity,
      unitCentavos: i.unitPriceCentavos + i.modifiersCentavos,
      lineCentavos: i.lineTotalCentavos,
      modifiers: i.modifiers.map((m) => m.name),
      notes: i.notes,
    })),
    subtotalCentavos: o.subtotalCentavos,
    discountCentavos: o.discountCentavos,
    deliveryFeeCentavos: o.deliveryFeeCentavos,
    totalCentavos: o.totalCentavos,
    payments: o.payments
      .filter((p) => p.kind === 'PAYMENT')
      .map((p) => ({ method: p.method, amountCentavos: p.amountCentavos, tenderedCentavos: p.tenderedCentavos, changeCentavos: p.changeCentavos, verified: p.verification === 'VERIFIED' })),
    delivery: o.delivery ? { address: o.delivery.address, contactNumber: o.delivery.contactNumber, areaName: o.delivery.areaName } : null,
  };
}

export function offlineToReceipt(p: OfflineOrderPayload, cashierName?: string): ReceiptData {
  return {
    reference: p.tempReference,
    offline: true,
    createdAt: p.clientCreatedAt,
    type: p.type,
    cashierName,
    customerName: p.customerName,
    items: p.items.map((i) => {
      const mods = i.modifiers.reduce((s, m) => s + m.priceCentavos, 0);
      return {
        name: i.productName,
        variant: i.variantName,
        quantity: i.quantity,
        unitCentavos: i.unitPriceCentavos + mods,
        lineCentavos: (i.unitPriceCentavos + mods) * i.quantity,
        modifiers: i.modifiers.map((m) => m.name),
        notes: i.notes,
      };
    }),
    subtotalCentavos: p.subtotalCentavos,
    discountCentavos: p.discountCentavos,
    deliveryFeeCentavos: p.deliveryFeeCentavos,
    totalCentavos: p.totalCentavos,
    payments: p.payments.map((x) => ({
      method: x.method,
      amountCentavos: x.amountCentavos,
      tenderedCentavos: x.tenderedCentavos,
      changeCentavos: x.method === 'CASH' && x.tenderedCentavos ? x.tenderedCentavos - x.amountCentavos : 0,
      verified: x.method === 'CASH',
    })),
    delivery: p.delivery ? { address: p.delivery.address, contactNumber: p.delivery.contactNumber, areaName: p.delivery.areaName } : null,
  };
}

export function ReceiptView({ r, shopName = "Aiv's Cafe" }: { r: ReceiptData; shopName?: string }) {
  const paid = r.payments.reduce((s, p) => s + p.amountCentavos, 0);
  const change = r.payments.reduce((s, p) => s + (p.changeCentavos ?? 0), 0);
  return (
    <div className="print-area mx-auto max-w-xs rounded-xl border border-line bg-white p-5 font-mono text-[13px] text-ink">
      <div className="text-center">
        <p className="font-heading text-lg font-bold">{shopName}</p>
        <p className="text-[11px]">Yummy Brew Blend &amp; Takoyaki Delight</p>
        <p className="text-[11px]">Bang-bang Road, Cordova, Cebu</p>
      </div>
      <div className="my-3 border-t border-dashed border-ink/30" />
      <p className="font-bold">{r.offline ? `TEMP # ${r.reference}` : `Order # ${r.reference}`}</p>
      {r.offline && <p className="text-[11px] font-bold">OFFLINE RECEIPT — not yet confirmed by the server</p>}
      <p>{fmtDateTime(r.createdAt)} · {TYPE_LABEL[r.type]}</p>
      {r.customerName && <p>Customer: {r.customerName}</p>}
      {r.cashierName && <p>Cashier: {r.cashierName}</p>}
      <div className="my-3 border-t border-dashed border-ink/30" />
      {r.items.map((it, i) => (
        <div key={i} className="mb-1.5">
          <div className="flex justify-between gap-2">
            <span>
              {it.quantity}× {it.name} ({it.variant})
            </span>
            <span className="tabular">{peso(it.lineCentavos)}</span>
          </div>
          {it.modifiers.length > 0 && <p className="pl-4 text-[11px]">+ {it.modifiers.join(', ')}</p>}
          {it.notes && <p className="pl-4 text-[11px] italic">“{it.notes}”</p>}
        </div>
      ))}
      <div className="my-3 border-t border-dashed border-ink/30" />
      <Row label="Subtotal" value={r.subtotalCentavos} />
      {r.discountCentavos > 0 && <Row label="Discount" value={-r.discountCentavos} />}
      {r.deliveryFeeCentavos > 0 && <Row label="Delivery fee" value={r.deliveryFeeCentavos} />}
      <Row label="TOTAL" value={r.totalCentavos} bold />
      <div className="my-2" />
      {r.payments.map((p, i) => (
        <Row key={i} label={`${p.method === 'CASH' ? 'Cash' : 'GCash'}${p.method === 'GCASH' && !p.verified ? ' (unverified)' : ''}`} value={p.tenderedCentavos ?? p.amountCentavos} />
      ))}
      {change > 0 && <Row label="Change" value={change} bold />}
      {paid < r.totalCentavos && <Row label="Balance due" value={r.totalCentavos - paid} bold />}
      {r.delivery && (
        <>
          <div className="my-3 border-t border-dashed border-ink/30" />
          <p className="font-bold">Deliver to ({r.delivery.areaName})</p>
          <p>{r.delivery.address}</p>
          <p>{r.delivery.contactNumber}</p>
        </>
      )}
      <div className="my-3 border-t border-dashed border-ink/30" />
      <p className="text-center text-[11px]">Salamat! Thank you</p>
      <p className="text-center text-[10px]">This is not an official receipt.</p>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span className="tabular">{peso(value)}</span>
    </div>
  );
}

export function ReceiptModal({ receipt, onClose, shopName }: { receipt: ReceiptData | null; onClose: () => void; shopName?: string }) {
  return (
    <Modal
      open={!!receipt}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          {receipt?.offline ? 'Saved on this device' : 'Sale recorded'}
          {receipt?.offline ? <Badge tone="warn">Pending sync</Badge> : <Badge tone="ok">Confirmed</Badge>}
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => window.print()}>
            Print
          </Button>
          <Button onClick={onClose}>Next customer</Button>
        </>
      }
    >
      {receipt && (
        <div className="space-y-3">
          {receipt.offline && (
            <p className="rounded-2xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
              No internet right now. This order is stored safely on this device and will sync automatically. The final order number is assigned after sync.
              {receipt.payments.some((p) => p.method === 'GCASH') && ' GCash payments stay “unverified” until someone checks them.'}
            </p>
          )}
          <ReceiptView r={receipt} shopName={shopName} />
        </div>
      )}
    </Modal>
  );
}
