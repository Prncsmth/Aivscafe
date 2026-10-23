import type { OrderStatus, OrderType, PaymentMethod } from '../types';

/** Pure POS cart math — mirrors the backend rules (backend/src/services/order.rules.ts). */

export interface CartModifier {
  modifierId: string;
  name: string;
  priceCentavos: number;
}

export interface CartLine {
  key: string;
  variantId: string;
  productName: string;
  variantName: string;
  unitPriceCentavos: number;
  modifiers: CartModifier[];
  quantity: number;
  notes?: string;
}

export interface PaymentDraft {
  method: PaymentMethod;
  amountCentavos: number;
  tenderedCentavos?: number | null;
  reference?: string | null;
  verified?: boolean;
}

export function lineKey(variantId: string, modifierIds: string[], notes = ''): string {
  return `${variantId}|${[...modifierIds].sort().join(',')}|${notes.trim()}`;
}

export function modifiersTotal(l: Pick<CartLine, 'modifiers'>): number {
  return l.modifiers.reduce((s, m) => s + m.priceCentavos, 0);
}

export function lineTotal(l: CartLine): number {
  return (l.unitPriceCentavos + modifiersTotal(l)) * l.quantity;
}

export function cartTotals(lines: CartLine[], discountCentavos: number, deliveryFeeCentavos: number) {
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const discount = Math.min(Math.max(0, discountCentavos), subtotal);
  return {
    subtotalCentavos: subtotal,
    discountCentavos: discount,
    deliveryFeeCentavos: Math.max(0, deliveryFeeCentavos),
    totalCentavos: subtotal - discount + Math.max(0, deliveryFeeCentavos),
  };
}

/** Same rules as the server: applied <= due, cash tendered >= applied, no GCash change. */
export function checkPayments(payments: PaymentDraft[], dueCentavos: number): { error?: string; changeCentavos: number; paidCentavos: number } {
  let paid = 0;
  let change = 0;
  for (const p of payments) {
    if (!Number.isSafeInteger(p.amountCentavos) || p.amountCentavos <= 0) return { error: 'Enter a payment amount', changeCentavos: 0, paidCentavos: paid };
    paid += p.amountCentavos;
    if (p.method === 'CASH') {
      const tendered = p.tenderedCentavos ?? p.amountCentavos;
      if (tendered < p.amountCentavos) return { error: 'Cash received is less than the amount', changeCentavos: 0, paidCentavos: paid };
      change += tendered - p.amountCentavos;
    }
  }
  if (paid > dueCentavos) return { error: 'Payment is more than the total', changeCentavos: change, paidCentavos: paid };
  return { changeCentavos: change, paidCentavos: paid };
}

export function addToCart(lines: CartLine[], incoming: Omit<CartLine, 'key'>): CartLine[] {
  const key = lineKey(incoming.variantId, incoming.modifiers.map((m) => m.modifierId), incoming.notes);
  const existing = lines.find((l) => l.key === key);
  if (existing) return lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(999, l.quantity + incoming.quantity) } : l));
  return [...lines, { ...incoming, key }];
}

export function setQuantity(lines: CartLine[], key: string, quantity: number): CartLine[] {
  if (quantity <= 0) return lines.filter((l) => l.key !== key);
  return lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(999, quantity) } : l));
}

export interface DeliveryDraft {
  customerName: string;
  contactNumber: string;
  address: string;
  areaId: string;
  areaName: string;
  instructions?: string;
}

export interface CheckoutDraft {
  clientId: string;
  type: OrderType;
  customerName?: string;
  notes?: string;
  lines: CartLine[];
  discountCentavos: number;
  discountReason?: string;
  deliveryFeeCentavos: number;
  delivery?: DeliveryDraft | null;
  payments: PaymentDraft[];
}

/** Body for POST /api/orders (server re-prices; expectedTotal detects stale prices). */
export function toOnlineRequest(d: CheckoutDraft, opts: { allowNegativeStock?: boolean; completeNow?: boolean } = {}) {
  const isDelivery = !!d.delivery && (d.type === 'DELIVERY' || d.type === 'MESSENGER');
  const totals = cartTotals(d.lines, d.discountCentavos, isDelivery ? d.deliveryFeeCentavos : 0);
  return {
    clientId: d.clientId,
    type: d.type,
    customerName: d.customerName || null,
    notes: d.notes || null,
    items: d.lines.map((l) => ({
      variantId: l.variantId,
      quantity: l.quantity,
      modifierIds: l.modifiers.map((m) => m.modifierId),
      notes: l.notes || null,
    })),
    discountCentavos: totals.discountCentavos,
    discountReason: d.discountReason || null,
    delivery:
      isDelivery && d.delivery
        ? {
            customerName: d.delivery.customerName,
            contactNumber: d.delivery.contactNumber,
            address: d.delivery.address,
            areaId: d.delivery.areaId,
            instructions: d.delivery.instructions || null,
          }
        : null,
    payments: d.payments.map((p) => ({
      method: p.method,
      amountCentavos: p.amountCentavos,
      tenderedCentavos: p.method === 'CASH' ? (p.tenderedCentavos ?? p.amountCentavos) : null,
      reference: p.reference || null,
      verified: p.method === 'GCASH' ? !!p.verified : undefined,
    })),
    expectedTotalCentavos: totals.totalCentavos,
    allowNegativeStock: opts.allowNegativeStock,
    completeNow: opts.completeNow,
  };
}

export interface OfflineOrderPayload {
  clientId: string;
  tempReference: string;
  clientCreatedAt: string;
  catalogVersion: number;
  shiftId: string | null;
  type: OrderType;
  status: OrderStatus;
  customerName: string | null;
  notes: string | null;
  items: {
    variantId: string;
    productName: string;
    variantName: string;
    unitPriceCentavos: number;
    quantity: number;
    notes: string | null;
    modifiers: CartModifier[];
  }[];
  discountCentavos: number;
  discountReason: string | null;
  deliveryFeeCentavos: number;
  delivery: (Omit<DeliveryDraft, 'instructions'> & { instructions: string | null }) | null;
  payments: { method: PaymentMethod; amountCentavos: number; tenderedCentavos: number | null; reference: string | null }[];
  subtotalCentavos: number;
  totalCentavos: number;
}

/** Body stored in IndexedDB and later sent to POST /api/sync/orders. Uses the cached (last synced) prices. */
export function toOfflinePayload(
  d: CheckoutDraft,
  ctx: { tempReference: string; catalogVersion: number; shiftId: string | null; status: OrderStatus; now?: Date },
): OfflineOrderPayload {
  const isDelivery = !!d.delivery && (d.type === 'DELIVERY' || d.type === 'MESSENGER');
  const totals = cartTotals(d.lines, d.discountCentavos, isDelivery ? d.deliveryFeeCentavos : 0);
  return {
    clientId: d.clientId,
    tempReference: ctx.tempReference,
    clientCreatedAt: (ctx.now ?? new Date()).toISOString(),
    catalogVersion: ctx.catalogVersion,
    shiftId: ctx.shiftId,
    type: d.type,
    status: ctx.status,
    customerName: d.customerName || d.delivery?.customerName || null,
    notes: d.notes || null,
    items: d.lines.map((l) => ({
      variantId: l.variantId,
      productName: l.productName,
      variantName: l.variantName,
      unitPriceCentavos: l.unitPriceCentavos,
      quantity: l.quantity,
      notes: l.notes || null,
      modifiers: l.modifiers,
    })),
    discountCentavos: totals.discountCentavos,
    discountReason: d.discountReason || null,
    deliveryFeeCentavos: totals.deliveryFeeCentavos,
    delivery: isDelivery && d.delivery ? { ...d.delivery, instructions: d.delivery.instructions || null } : null,
    payments: d.payments.map((p) => ({
      method: p.method,
      amountCentavos: p.amountCentavos,
      tenderedCentavos: p.method === 'CASH' ? (p.tenderedCentavos ?? p.amountCentavos) : null,
      reference: p.reference || null,
    })),
    subtotalCentavos: totals.subtotalCentavos,
    totalCentavos: totals.totalCentavos,
  };
}
