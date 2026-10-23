import type { OrderStatus, PaymentStatus } from '@prisma/client';

/** Pure order rules (no database) — shared by online orders and offline sync. */

export const PICKUP_FLOW: OrderStatus[] = ['PENDING', 'PREPARING', 'READY', 'COMPLETED'];
export const DELIVERY_FLOW: OrderStatus[] = ['PENDING', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'];

export const FINAL_STATUSES: OrderStatus[] = ['COMPLETED', 'DELIVERED', 'CANCELLED', 'VOIDED'];

export function flowFor(isDelivery: boolean): OrderStatus[] {
  return isDelivery ? DELIVERY_FLOW : PICKUP_FLOW;
}

/** The single allowed forward step, or null if the order is at the end of its flow. */
export function nextStatus(current: OrderStatus, isDelivery: boolean): OrderStatus | null {
  const flow = flowFor(isDelivery);
  const i = flow.indexOf(current);
  if (i < 0 || i === flow.length - 1) return null;
  return flow[i + 1];
}

export function canAdvance(from: OrderStatus, to: OrderStatus, isDelivery: boolean): boolean {
  return nextStatus(from, isDelivery) === to;
}

/** Statuses from which an order can be cancelled (before hand-over). */
export function isCancellable(status: OrderStatus): boolean {
  return status === 'PENDING' || status === 'PREPARING' || status === 'READY' || status === 'OUT_FOR_DELIVERY';
}

/** Voiding applies to orders already handed over. */
export function isVoidable(status: OrderStatus): boolean {
  return status === 'COMPLETED' || status === 'DELIVERED';
}

export function paymentStatusFor(totalCentavos: number, paidCentavos: number, refundedCentavos: number): PaymentStatus {
  if (refundedCentavos > 0) return refundedCentavos >= paidCentavos ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  if (paidCentavos <= 0) return 'UNPAID';
  if (paidCentavos < totalCentavos) return 'PARTIALLY_PAID';
  return 'PAID';
}

export interface LineForTotals {
  unitPriceCentavos: number;
  modifiersCentavos: number;
  quantity: number;
}

export function lineTotal(l: LineForTotals): number {
  return (l.unitPriceCentavos + l.modifiersCentavos) * l.quantity;
}

export function computeTotals(lines: LineForTotals[], discountCentavos: number, deliveryFeeCentavos: number) {
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const discount = Math.min(Math.max(0, discountCentavos), subtotal);
  const total = subtotal - discount + Math.max(0, deliveryFeeCentavos);
  return { subtotalCentavos: subtotal, discountCentavos: discount, totalCentavos: total };
}

export interface PaymentInput {
  method: 'CASH' | 'GCASH';
  amountCentavos: number;
  tenderedCentavos?: number | null;
  reference?: string | null;
}

/**
 * Validate a set of payments against an amount due. Returns change per payment.
 * Rules: amounts > 0; total applied <= due; cash tendered >= amount; GCash has no change.
 */
export function validatePayments(payments: PaymentInput[], dueCentavos: number): { error?: string; changes: number[] } {
  let applied = 0;
  const changes: number[] = [];
  for (const p of payments) {
    if (!Number.isSafeInteger(p.amountCentavos) || p.amountCentavos <= 0) return { error: 'Payment amount must be positive', changes };
    applied += p.amountCentavos;
    if (p.method === 'CASH') {
      const tendered = p.tenderedCentavos ?? p.amountCentavos;
      if (tendered < p.amountCentavos) return { error: 'Cash tendered is less than the amount applied', changes };
      changes.push(tendered - p.amountCentavos);
    } else {
      if (p.tenderedCentavos != null && p.tenderedCentavos !== p.amountCentavos) {
        return { error: 'GCash payments cannot have change', changes };
      }
      changes.push(0);
    }
  }
  if (applied > dueCentavos) return { error: 'Payments exceed the amount due', changes };
  return { changes };
}

/** Expected drawer cash = starting cash + cash received − cash refunded + cash in − cash out. GCash is never cash. */
export function expectedCash(args: {
  startingCash: number;
  cashPayments: number;
  cashRefunds: number;
  cashIn: number;
  cashOut: number;
}): number {
  return args.startingCash + args.cashPayments - args.cashRefunds + args.cashIn - args.cashOut;
}
