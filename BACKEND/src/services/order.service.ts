import { Prisma, type OrderStatus, type OrderType, type Role } from '@prisma/client';
import type { Db, Tx } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { getSettings, getCatalogVersion } from '../lib/settings';
import { businessDay } from '../lib/time';
import { percentOf } from '../lib/money';
import { deductForOrder, reverseForOrder, type Shortage } from './inventory.service';
import {
  canAdvance,
  computeTotals,
  isCancellable,
  isVoidable,
  lineTotal,
  nextStatus,
  paymentStatusFor,
  validatePayments,
  type PaymentInput,
} from './order.rules';

export const orderInclude = {
  items: { include: { modifiers: true } },
  payments: { orderBy: { createdAt: 'asc' } },
  delivery: true,
  conflicts: true,
  cashier: { select: { id: true, name: true } },
} satisfies Prisma.OrderInclude;

export type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export interface ActingUser {
  id: string;
  role: Role;
}

// ─────────────────────────── pricing ───────────────────────────

export interface CartLineInput {
  variantId: string;
  quantity: number;
  modifierIds?: string[];
  notes?: string | null;
}

export interface PricedLine {
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  unitPriceCentavos: number;
  modifiersCentavos: number;
  quantity: number;
  lineTotalCentavos: number;
  notes: string | null;
  modifiers: { modifierId: string; name: string; priceCentavos: number }[];
  available: boolean;
}

/** Price cart lines from the current catalog. The server is the source of truth for online prices. */
export async function priceLines(db: Db, lines: CartLineInput[]): Promise<PricedLine[]> {
  const variantIds = [...new Set(lines.map((l) => l.variantId))];
  const variants = await db.productVariant.findMany({
    where: { id: { in: variantIds } },
    include: { product: { include: { modifiers: { include: { modifier: true } } } } },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));

  return lines.map((line, idx) => {
    const v = byId.get(line.variantId);
    if (!v) throw badRequest(`Item ${idx + 1}: product variant not found`);
    const allowed = new Map(v.product.modifiers.map((pm) => [pm.modifierId, pm.modifier]));
    const modifierIds = [...new Set(line.modifierIds ?? [])];
    const modifiers = modifierIds.map((mid) => {
      const m = allowed.get(mid);
      if (!m) throw badRequest(`Item ${idx + 1}: add-on is not available for ${v.product.name}`);
      return { modifierId: m.id, name: m.name, priceCentavos: m.priceCentavos, active: m.isActive };
    });
    const modifiersCentavos = modifiers.reduce((s, m) => s + m.priceCentavos, 0);
    const available =
      v.isActive && v.isAvailable && v.product.isActive && v.product.isAvailable && modifiers.every((m) => m.active);
    const priced = {
      unitPriceCentavos: v.priceCentavos,
      modifiersCentavos,
      quantity: line.quantity,
    };
    return {
      productId: v.productId,
      variantId: v.id,
      productName: v.product.name,
      variantName: v.name,
      ...priced,
      lineTotalCentavos: lineTotal(priced),
      notes: line.notes ?? null,
      modifiers: modifiers.map(({ modifierId, name, priceCentavos }) => ({ modifierId, name, priceCentavos })),
      available,
    };
  });
}

// ─────────────────────────── references ───────────────────────────

/** Atomic per-day counter => AIV-20251023-0001 */
export async function nextReference(tx: Tx, prefix: string, at = new Date()): Promise<string> {
  const day = businessDay(at).replace(/-/g, '');
  const rows = await tx.$queryRaw<{ lastSeq: number }[]>`
    INSERT INTO "OrderCounter" ("day", "lastSeq") VALUES (${day}, 1)
    ON CONFLICT ("day") DO UPDATE SET "lastSeq" = "OrderCounter"."lastSeq" + 1
    RETURNING "lastSeq"`;
  return `${prefix}-${day}-${String(rows[0].lastSeq).padStart(4, '0')}`;
}

// ─────────────────────────── shifts ───────────────────────────

export async function requireOpenShift(db: Db, userId: string) {
  const shift = await db.cashShift.findUnique({ where: { openKey: userId } });
  if (!shift) throw conflict('NO_OPEN_SHIFT', 'Open a shift before taking orders or payments');
  return shift;
}

// ─────────────────────────── payments ───────────────────────────

async function refreshPaymentTotals(tx: Tx, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { totalCentavos: true } });
  const grouped = await tx.payment.groupBy({ by: ['kind'], where: { orderId }, _sum: { amountCentavos: true } });
  const paid = grouped.find((g) => g.kind === 'PAYMENT')?._sum.amountCentavos ?? 0;
  const refunded = grouped.find((g) => g.kind === 'REFUND')?._sum.amountCentavos ?? 0;
  return tx.order.update({
    where: { id: orderId },
    data: {
      paidCentavos: paid,
      refundedCentavos: refunded,
      paymentStatus: paymentStatusFor(order.totalCentavos, paid, refunded),
    },
  });
}

export async function insertPayments(
  tx: Tx,
  args: {
    orderId: string;
    payments: (PaymentInput & { verified?: boolean })[];
    dueCentavos: number;
    userId: string;
    shiftId: string | null;
    offline: boolean;
  },
) {
  const { error, changes } = validatePayments(args.payments, args.dueCentavos);
  if (error) throw badRequest(error);
  for (const [i, p] of args.payments.entries()) {
    // GCash recorded offline can never be verified at the time of recording.
    const verified = p.method === 'CASH' || (!args.offline && p.verified === true);
    await tx.payment.create({
      data: {
        orderId: args.orderId,
        kind: 'PAYMENT',
        method: p.method,
        amountCentavos: p.amountCentavos,
        tenderedCentavos: p.method === 'CASH' ? (p.tenderedCentavos ?? p.amountCentavos) : null,
        changeCentavos: p.method === 'CASH' ? changes[i] : null,
        reference: p.reference ?? null,
        verification: verified ? 'VERIFIED' : 'UNVERIFIED',
        verifiedById: verified && p.method === 'GCASH' ? args.userId : null,
        verifiedAt: verified && p.method === 'GCASH' ? new Date() : null,
        recordedOffline: args.offline,
        shiftId: args.shiftId,
        userId: args.userId,
      },
    });
  }
  return refreshPaymentTotals(tx, args.orderId);
}

// ─────────────────────────── create (online) ───────────────────────────

export interface CreateOrderInput {
  clientId: string;
  type: OrderType;
  customerName?: string | null;
  notes?: string | null;
  items: CartLineInput[];
  discountCentavos?: number;
  discountReason?: string | null;
  delivery?: {
    customerName: string;
    contactNumber: string;
    address: string;
    areaId: string;
    instructions?: string | null;
    deliveryFeeCentavos?: number;
  } | null;
  payments?: (PaymentInput & { verified?: boolean })[];
  /** If provided, the server refuses the order when its own total differs (prices changed). */
  expectedTotalCentavos?: number;
  /** Owner-only: accept the order even if stock would go negative. */
  allowNegativeStock?: boolean;
  /** Quick sale. Defaults to the autoCompleteWalkIn setting for walk-in orders. */
  completeNow?: boolean;
}

export async function createOrder(tx: Tx, user: ActingUser, input: CreateOrderInput): Promise<{ order: OrderWithRelations; duplicate: boolean; shortages: Shortage[] }> {
  // Idempotency: the same clientId always returns the same order.
  const existing = await tx.order.findUnique({ where: { clientId: input.clientId }, include: orderInclude });
  if (existing) return { order: existing, duplicate: true, shortages: [] };

  const settings = await getSettings(tx);
  const shift = await requireOpenShift(tx, user.id);
  const priced = await priceLines(tx, input.items);

  const unavailable = priced.filter((p) => !p.available);
  if (unavailable.length) {
    throw conflict('PRODUCT_UNAVAILABLE', 'Some items are no longer available', {
      items: unavailable.map((u) => `${u.productName} (${u.variantName})`),
    });
  }

  if (settings.walkInOnly && input.type !== 'WALK_IN') {
    throw badRequest('This shop is set to walk-in only. Turn on delivery and Messenger orders in Settings first.');
  }
  const isDelivery = input.type === 'DELIVERY' || (input.type === 'MESSENGER' && !!input.delivery);
  if (input.type === 'DELIVERY' && !input.delivery) throw badRequest('Delivery orders need delivery details');

  let deliveryFee = 0;
  let area: { id: string; name: string; feeCentavos: number } | null = null;
  if (isDelivery && input.delivery) {
    area = await tx.deliveryArea.findFirst({ where: { id: input.delivery.areaId, isActive: true } });
    if (!area) throw badRequest('Delivery area not found or inactive');
    deliveryFee = input.delivery.deliveryFeeCentavos ?? area.feeCentavos;
  }

  const totals = computeTotals(priced, input.discountCentavos ?? 0, deliveryFee);
  if ((input.discountCentavos ?? 0) > totals.discountCentavos) throw badRequest('Discount cannot exceed the subtotal');
  if (totals.discountCentavos > 0 && !input.discountReason) throw badRequest('A discount needs a reason');
  if (user.role === 'CASHIER' && totals.discountCentavos > percentOf(totals.subtotalCentavos, settings.maxCashierDiscountPercent)) {
    throw forbidden(`Cashiers may discount at most ${settings.maxCashierDiscountPercent}% of the subtotal`);
  }
  if (input.expectedTotalCentavos != null && input.expectedTotalCentavos !== totals.totalCentavos) {
    throw conflict('PRICE_CHANGED', 'Prices changed since the menu was loaded. Please review the order.', {
      expectedTotalCentavos: input.expectedTotalCentavos,
      serverTotalCentavos: totals.totalCentavos,
    });
  }
  if (input.allowNegativeStock && user.role !== 'OWNER') throw forbidden('Only the owner can override stock limits');

  const reference = await nextReference(tx, settings.orderPrefix);
  const order = await tx.order.create({
    data: {
      clientId: input.clientId,
      reference,
      type: input.type,
      source: 'ONLINE',
      customerName: input.customerName ?? input.delivery?.customerName ?? null,
      notes: input.notes ?? null,
      ...totals,
      discountReason: totals.discountCentavos > 0 ? input.discountReason : null,
      deliveryFeeCentavos: deliveryFee,
      cashierId: user.id,
      shiftId: shift.id,
      catalogVersion: await getCatalogVersion(tx),
      items: {
        create: priced.map((p) => ({
          productId: p.productId,
          variantId: p.variantId,
          productName: p.productName,
          variantName: p.variantName,
          unitPriceCentavos: p.unitPriceCentavos,
          modifiersCentavos: p.modifiersCentavos,
          quantity: p.quantity,
          lineTotalCentavos: p.lineTotalCentavos,
          notes: p.notes,
          modifiers: { create: p.modifiers },
        })),
      },
      delivery:
        isDelivery && input.delivery && area
          ? {
              create: {
                customerName: input.delivery.customerName,
                contactNumber: input.delivery.contactNumber,
                address: input.delivery.address,
                areaId: area.id,
                areaName: area.name,
                deliveryFeeCentavos: deliveryFee,
                instructions: input.delivery.instructions ?? null,
              },
            }
          : undefined,
      statusLog: { create: { toStatus: 'PENDING', userId: user.id } },
    },
  });

  const allowNegative = settings.insufficientStockPolicy === 'ALLOW' || input.allowNegativeStock === true;
  const { shortages } = await deductForOrder(tx, {
    orderId: order.id,
    lines: priced.map((p) => ({ variantId: p.variantId, quantity: p.quantity, modifierIds: p.modifiers.map((m) => m.modifierId) })),
    allowNegative,
    userId: user.id,
  });
  if (shortages.length) {
    await tx.order.update({ where: { id: order.id }, data: { stockOverride: true } });
    await audit(tx, { userId: user.id, action: 'STOCK_NEGATIVE_ALLOWED', entity: 'Order', entityId: order.id, details: { shortages, policy: settings.insufficientStockPolicy } });
  }

  if (input.payments?.length) {
    await insertPayments(tx, {
      orderId: order.id,
      payments: input.payments,
      dueCentavos: totals.totalCentavos,
      userId: user.id,
      shiftId: shift.id,
      offline: false,
    });
  }
  // Quick sale: the customer is at the counter and has paid, so skip the order queue.
  // In walk-in-only mode every sale is completed (and must be fully paid).
  const wantsComplete = settings.walkInOnly ? true : (input.completeNow ?? (input.type === 'WALK_IN' && settings.autoCompleteWalkIn));
  if (wantsComplete && !isDelivery) {
    const paid = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { paymentStatus: true } });
    if (paid.paymentStatus === 'PAID') {
      await tx.order.update({ where: { id: order.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      await tx.orderStatusEvent.create({ data: { orderId: order.id, fromStatus: 'PENDING', toStatus: 'COMPLETED', userId: user.id, note: 'Quick sale' } });
    } else if (settings.walkInOnly) {
      throw badRequest('Collect the full payment to complete the sale.');
    } else if (input.completeNow === true) {
      throw badRequest('A quick sale must be fully paid. Record the payment or turn off "Complete sale now".');
    }
  }
  if (area && input.delivery?.deliveryFeeCentavos != null && input.delivery.deliveryFeeCentavos !== area.feeCentavos) {
    await audit(tx, { userId: user.id, action: 'DELIVERY_FEE_OVERRIDE', entity: 'Order', entityId: order.id, details: { areaFee: area.feeCentavos, charged: deliveryFee } });
  }
  await audit(tx, { userId: user.id, action: 'ORDER_CREATED', entity: 'Order', entityId: order.id, details: { reference, total: totals.totalCentavos } });

  const full = await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
  return { order: full, duplicate: false, shortages };
}

// ─────────────────────────── status workflow ───────────────────────────

export async function advanceStatus(tx: Tx, user: ActingUser, orderId: string, to: OrderStatus) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { delivery: true } });
  if (!order) throw notFound('Order');
  const isDelivery = !!order.delivery;
  if (!canAdvance(order.status, to, isDelivery)) {
    throw conflict('INVALID_TRANSITION', `Cannot move order from ${order.status} to ${to}`, {
      allowedNext: nextStatus(order.status, isDelivery),
    });
  }
  if ((to === 'COMPLETED' || to === 'DELIVERED') && order.paymentStatus !== 'PAID') {
    throw conflict('UNPAID', 'Record full payment before completing the order');
  }
  // Optimistic guard: status must still be what we read.
  const updated = await tx.order.updateMany({
    where: { id: orderId, status: order.status },
    data: { status: to, completedAt: to === 'COMPLETED' || to === 'DELIVERED' ? new Date() : undefined },
  });
  if (updated.count === 0) throw conflict('STALE', 'The order was changed by someone else. Refresh and try again.');
  if (order.delivery && (to === 'OUT_FOR_DELIVERY' || to === 'DELIVERED')) {
    await tx.deliveryDetails.update({
      where: { orderId },
      data: to === 'OUT_FOR_DELIVERY' ? { dispatchedAt: new Date() } : { deliveredAt: new Date() },
    });
  }
  await tx.orderStatusEvent.create({ data: { orderId, fromStatus: order.status, toStatus: to, userId: user.id } });
  return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
}

// ─────────────────────────── cancel / void ───────────────────────────

/**
 * Inventory reversal policy
 * - Cancelled while PENDING: nothing was prepared, ingredients are restored automatically.
 * - Cancelled after preparation started, or voided: ingredients are treated as used (no restore)
 *   unless the owner explicitly sets restoreInventory=true.
 * - Restoration happens at most once per order (guarded in reverseForOrder).
 * Refunds: all recorded payments are refunded by the same method into the acting user's open shift.
 */
export async function cancelOrVoid(
  tx: Tx,
  user: ActingUser,
  orderId: string,
  args: { mode: 'CANCEL' | 'VOID'; reason: string; restoreInventory?: boolean; refund?: boolean },
) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { payments: true } });
  if (!order) throw notFound('Order');

  if (args.mode === 'CANCEL') {
    if (!isCancellable(order.status)) throw conflict('INVALID_TRANSITION', `A ${order.status} order cannot be cancelled`);
    if (order.status !== 'PENDING' && user.role !== 'OWNER') {
      throw forbidden('Only the owner can cancel an order that is already being prepared');
    }
  } else {
    if (user.role !== 'OWNER') throw forbidden('Only the owner can void a completed order');
    if (!isVoidable(order.status)) throw conflict('INVALID_TRANSITION', `A ${order.status} order cannot be voided`);
  }
  if (args.restoreInventory && user.role !== 'OWNER') throw forbidden('Only the owner can choose to restore inventory');

  const toStatus: OrderStatus = args.mode === 'CANCEL' ? 'CANCELLED' : 'VOIDED';
  const updated = await tx.order.updateMany({
    where: { id: orderId, status: order.status },
    data: { status: toStatus, cancelledAt: new Date(), cancelledById: user.id, cancelReason: args.reason },
  });
  if (updated.count === 0) throw conflict('STALE', 'The order was changed by someone else. Refresh and try again.');
  await tx.orderStatusEvent.create({ data: { orderId, fromStatus: order.status, toStatus, userId: user.id, note: args.reason } });

  const restore = order.status === 'PENDING' || args.restoreInventory === true;
  const restored = restore ? await reverseForOrder(tx, { orderId, userId: user.id, reason: `${toStatus}: ${args.reason}` }) : false;

  // Refund whatever is still net-paid, per method.
  let refunds: { method: 'CASH' | 'GCASH'; amount: number }[] = [];
  if (args.refund !== false) {
    const net = { CASH: 0, GCASH: 0 };
    for (const p of order.payments) net[p.method] += p.kind === 'PAYMENT' ? p.amountCentavos : -p.amountCentavos;
    refunds = (['CASH', 'GCASH'] as const).filter((m) => net[m] > 0).map((m) => ({ method: m, amount: net[m] }));
    if (refunds.length) {
      const shift = await tx.cashShift.findUnique({ where: { openKey: user.id } });
      if (refunds.some((r) => r.method === 'CASH') && !shift) {
        throw conflict('NO_OPEN_SHIFT', 'Open a shift to pay out a cash refund');
      }
      for (const r of refunds) {
        await tx.payment.create({
          data: {
            orderId,
            kind: 'REFUND',
            method: r.method,
            amountCentavos: r.amount,
            verification: r.method === 'CASH' ? 'VERIFIED' : 'UNVERIFIED',
            shiftId: shift?.id ?? null,
            userId: user.id,
            note: args.reason,
          },
        });
      }
      await refreshPaymentTotals(tx, orderId);
    }
  }

  await audit(tx, {
    userId: user.id,
    action: args.mode === 'CANCEL' ? 'ORDER_CANCELLED' : 'ORDER_VOIDED',
    entity: 'Order',
    entityId: orderId,
    details: { reference: order.reference, fromStatus: order.status, reason: args.reason, inventoryRestored: restored, refunds },
  });
  return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
}

// ─────────────────────────── add payment later ───────────────────────────

export async function addPayment(tx: Tx, user: ActingUser, orderId: string, payment: PaymentInput & { verified?: boolean }) {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) throw notFound('Order');
  if (order.status === 'CANCELLED' || order.status === 'VOIDED') throw conflict('ORDER_CLOSED', 'This order is cancelled');
  const due = order.totalCentavos - order.paidCentavos + order.refundedCentavos;
  if (due <= 0) throw conflict('ALREADY_PAID', 'This order is already fully paid');
  const shift = await requireOpenShift(tx, user.id);
  await insertPayments(tx, { orderId, payments: [payment], dueCentavos: due, userId: user.id, shiftId: shift.id, offline: false });
  await audit(tx, { userId: user.id, action: 'PAYMENT_RECORDED', entity: 'Order', entityId: orderId, details: { method: payment.method, amount: payment.amountCentavos } });
  return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
}

export async function verifyPayment(tx: Tx, user: ActingUser, paymentId: string, reference?: string | null) {
  const p = await tx.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw notFound('Payment');
  if (p.method !== 'GCASH') throw badRequest('Only GCash payments need verification');
  if (p.verification === 'VERIFIED') return p;
  const updated = await tx.payment.update({
    where: { id: paymentId },
    data: { verification: 'VERIFIED', verifiedById: user.id, verifiedAt: new Date(), reference: reference ?? p.reference },
  });
  await audit(tx, { userId: user.id, action: 'GCASH_VERIFIED', entity: 'Payment', entityId: paymentId, details: { orderId: p.orderId, amount: p.amountCentavos } });
  return updated;
}
