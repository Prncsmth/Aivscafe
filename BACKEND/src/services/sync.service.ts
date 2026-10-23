import { Prisma, type ConflictType, type OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma, withTx, type Tx } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { audit } from '../lib/audit';
import { getCatalogVersion, getSettings } from '../lib/settings';
import { percentOf } from '../lib/money';
import { deductForOrder } from './inventory.service';
import { computeTotals, lineTotal, paymentStatusFor, validatePayments, type PaymentInput } from './order.rules';
import { insertPayments, nextReference, orderInclude, priceLines, type ActingUser } from './order.service';

const money = z.number().int().min(0);

export const OfflineOrderSchema = z.object({
  clientId: z.string().uuid(),
  tempReference: z.string().max(40),
  clientCreatedAt: z.coerce.date(),
  catalogVersion: z.number().int().min(0),
  shiftId: z.string().nullable().optional(),
  type: z.enum(['WALK_IN', 'DELIVERY', 'MESSENGER']),
  status: z.enum(['PENDING', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED']).default('PENDING'),
  cancelReason: z.string().max(300).nullable().optional(),
  customerName: z.string().max(120).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        productName: z.string().min(1).max(160),
        variantName: z.string().min(1).max(80),
        unitPriceCentavos: money,
        quantity: z.number().int().min(1).max(999),
        notes: z.string().max(300).nullable().optional(),
        modifiers: z
          .array(z.object({ modifierId: z.string().min(1), name: z.string().max(120), priceCentavos: money }))
          .default([]),
      }),
    )
    .min(1)
    .max(100),
  discountCentavos: money.default(0),
  discountReason: z.string().max(200).nullable().optional(),
  deliveryFeeCentavos: money.default(0),
  delivery: z
    .object({
      customerName: z.string().min(1).max(120),
      contactNumber: z.string().min(3).max(40),
      address: z.string().min(1).max(500),
      areaId: z.string().nullable().optional(),
      areaName: z.string().min(1).max(120),
      instructions: z.string().max(500).nullable().optional(),
    })
    .nullable()
    .optional(),
  payments: z
    .array(
      z.object({
        method: z.enum(['CASH', 'GCASH']),
        amountCentavos: z.number().int().positive(),
        tenderedCentavos: z.number().int().positive().nullable().optional(),
        reference: z.string().max(80).nullable().optional(),
      }),
    )
    .default([]),
  subtotalCentavos: money,
  totalCentavos: money,
});
export type OfflineOrder = z.infer<typeof OfflineOrderSchema>;

export const SyncRequestSchema = z.object({
  deviceId: z.string().min(1).max(80),
  orders: z.array(z.unknown()).min(1).max(50),
});

export type SyncResult =
  | {
      clientId: string;
      status: 'SYNCED';
      duplicate: boolean;
      orderId: string;
      reference: string;
      conflicts: ConflictType[];
    }
  | {
      clientId: string | null;
      status: 'FAILED';
      retryable: boolean;
      error: { code: string; message: string; details?: unknown };
    };

class NonRetryable extends Error {
  constructor(public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

async function existingResult(clientId: string): Promise<SyncResult | null> {
  const found = await prisma.order.findUnique({
    where: { clientId },
    select: { id: true, reference: true, conflicts: { select: { type: true } } },
  });
  if (!found) return null;
  return {
    clientId,
    status: 'SYNCED',
    duplicate: true,
    orderId: found.id,
    reference: found.reference,
    conflicts: found.conflicts.map((c) => c.type),
  };
}

/** Workflow-respecting status for a synced order; completion requires full payment. */
function clampStatus(status: OrderStatus, isDelivery: boolean, fullyPaid: boolean): OrderStatus {
  if (isDelivery && status === 'COMPLETED') status = 'DELIVERED';
  if (!isDelivery && (status === 'OUT_FOR_DELIVERY' || status === 'DELIVERED')) status = 'COMPLETED';
  if ((status === 'COMPLETED' || status === 'DELIVERED') && !fullyPaid) return 'READY';
  return status;
}

async function syncOne(tx: Tx, user: ActingUser, deviceId: string, o: OfflineOrder) {
  const settings = await getSettings(tx);
  const conflicts: { type: ConflictType; details: Prisma.InputJsonValue }[] = [];

  // 1. Internal consistency of what the device recorded. A mismatch means corrupt data: not retryable.
  const lines = o.items.map((it) => ({
    unitPriceCentavos: it.unitPriceCentavos,
    modifiersCentavos: it.modifiers.reduce((s, m) => s + m.priceCentavos, 0),
    quantity: it.quantity,
  }));
  const totals = computeTotals(lines, o.discountCentavos, o.deliveryFeeCentavos);
  if (totals.subtotalCentavos !== o.subtotalCentavos || totals.totalCentavos !== o.totalCentavos || totals.discountCentavos !== o.discountCentavos) {
    throw new NonRetryable('TOTAL_MISMATCH', 'Order totals do not add up', { computed: totals });
  }
  const payCheck = validatePayments(o.payments as PaymentInput[], o.totalCentavos);
  if (payCheck.error) throw new NonRetryable('INVALID_PAYMENT', payCheck.error);
  if (o.type === 'DELIVERY' && !o.delivery) throw new NonRetryable('MISSING_DELIVERY', 'Delivery orders need delivery details');

  // 2. Revalidate against the current catalog. Variants are archived, never deleted, so ids resolve.
  let current;
  try {
    current = await priceLines(
      tx,
      o.items.map((it) => ({ variantId: it.variantId, quantity: it.quantity, modifierIds: it.modifiers.map((m) => m.modifierId) })),
    );
  } catch (e) {
    throw new NonRetryable('UNKNOWN_ITEM', e instanceof Error ? e.message : 'Unknown item');
  }
  const serverVersion = await getCatalogVersion(tx);
  const priceDiffs = o.items
    .map((it, i) => ({
      item: `${it.productName} (${it.variantName})`,
      chargedUnitCentavos: it.unitPriceCentavos + lines[i].modifiersCentavos,
      currentUnitCentavos: current[i].unitPriceCentavos + current[i].modifiersCentavos,
    }))
    .filter((d) => d.chargedUnitCentavos !== d.currentUnitCentavos);
  if (priceDiffs.length) {
    // The customer already paid the offline price: keep it, but flag it for the owner.
    conflicts.push({
      type: 'PRICE_MISMATCH',
      details: { deviceCatalogVersion: o.catalogVersion, serverCatalogVersion: serverVersion, items: priceDiffs },
    });
  }
  const unavailable = current.filter((c) => !c.available).map((c) => `${c.productName} (${c.variantName})`);
  if (unavailable.length) conflicts.push({ type: 'PRODUCT_UNAVAILABLE', details: { items: unavailable } });

  const shiftOwner = await tx.user.findUnique({ where: { id: user.id }, select: { role: true } });
  if (shiftOwner?.role === 'CASHIER' && o.discountCentavos > percentOf(o.subtotalCentavos, settings.maxCashierDiscountPercent)) {
    conflicts.push({
      type: 'DISCOUNT_LIMIT',
      details: { discountCentavos: o.discountCentavos, limitPercent: settings.maxCashierDiscountPercent },
    });
  }

  // 3. Shift attribution.
  let shiftId: string | null = null;
  let cashierId = user.id;
  if (o.shiftId) {
    const shift = await tx.cashShift.findUnique({ where: { id: o.shiftId } });
    if (shift) {
      shiftId = shift.id;
      cashierId = shift.userId;
      if (shift.status === 'CLOSED') conflicts.push({ type: 'SHIFT_CLOSED', details: { shiftId: shift.id, closedAt: shift.closedAt?.toISOString() ?? null } });
    }
  }
  if (!shiftId) {
    const open = await tx.cashShift.findUnique({ where: { openKey: user.id } });
    shiftId = open?.id ?? null;
    conflicts.push({ type: 'SHIFT_CLOSED', details: { reason: 'Original shift not found on server', reassignedTo: shiftId } });
  }

  // 4. Create the order with the prices the device charged.
  const isDelivery = o.type === 'DELIVERY' || (o.type === 'MESSENGER' && !!o.delivery);
  const paid = o.payments.reduce((s, p) => s + p.amountCentavos, 0);
  const status: OrderStatus =
    o.status === 'CANCELLED' ? 'CANCELLED' : clampStatus(o.status, isDelivery, paymentStatusFor(o.totalCentavos, paid, 0) === 'PAID');
  let area = null;
  if (isDelivery && o.delivery?.areaId) area = await tx.deliveryArea.findUnique({ where: { id: o.delivery.areaId } });

  const reference = await nextReference(tx, settings.orderPrefix, o.clientCreatedAt);
  const order = await tx.order.create({
    data: {
      clientId: o.clientId,
      reference,
      tempReference: o.tempReference,
      type: o.type,
      status,
      source: 'OFFLINE_SYNC',
      customerName: o.customerName ?? o.delivery?.customerName ?? null,
      notes: o.notes ?? null,
      ...totals,
      discountReason: o.discountCentavos > 0 ? (o.discountReason ?? 'Offline discount') : null,
      deliveryFeeCentavos: o.deliveryFeeCentavos,
      cashierId,
      shiftId,
      catalogVersion: o.catalogVersion,
      clientCreatedAt: o.clientCreatedAt,
      createdAt: o.clientCreatedAt,
      syncedAt: new Date(),
      completedAt: status === 'COMPLETED' || status === 'DELIVERED' ? o.clientCreatedAt : null,
      cancelledAt: status === 'CANCELLED' ? new Date() : null,
      cancelledById: status === 'CANCELLED' ? user.id : null,
      cancelReason: status === 'CANCELLED' ? (o.cancelReason ?? 'Cancelled while offline') : null,
      items: {
        create: o.items.map((it, i) => ({
          productId: current[i].productId,
          variantId: it.variantId,
          productName: it.productName,
          variantName: it.variantName,
          unitPriceCentavos: it.unitPriceCentavos,
          modifiersCentavos: lines[i].modifiersCentavos,
          quantity: it.quantity,
          lineTotalCentavos: lineTotal(lines[i]),
          notes: it.notes ?? null,
          modifiers: { create: it.modifiers.map((m) => ({ modifierId: m.modifierId, name: m.name, priceCentavos: m.priceCentavos })) },
        })),
      },
      delivery:
        isDelivery && o.delivery
          ? {
              create: {
                customerName: o.delivery.customerName,
                contactNumber: o.delivery.contactNumber,
                address: o.delivery.address,
                areaId: area?.id ?? null,
                areaName: o.delivery.areaName,
                deliveryFeeCentavos: o.deliveryFeeCentavos,
                instructions: o.delivery.instructions ?? null,
              },
            }
          : undefined,
      statusLog: { create: { toStatus: status, userId: user.id, note: `Synced from device ${deviceId}` } },
    },
  });

  // 5. Inventory: the sale already happened, so it is never refused — shortages are flagged instead.
  if (status !== 'CANCELLED') {
    const { shortages } = await deductForOrder(tx, {
      orderId: order.id,
      lines: o.items.map((it) => ({ variantId: it.variantId, quantity: it.quantity, modifierIds: it.modifiers.map((m) => m.modifierId) })),
      allowNegative: true,
      userId: user.id,
    });
    if (shortages.length) {
      conflicts.push({ type: 'INSUFFICIENT_STOCK', details: { shortages } as unknown as Prisma.InputJsonValue });
      await tx.order.update({ where: { id: order.id }, data: { stockOverride: true } });
    }
  }

  // 6. Payments. Offline GCash is always recorded as UNVERIFIED.
  if (o.payments.length && status !== 'CANCELLED') {
    await insertPayments(tx, {
      orderId: order.id,
      payments: o.payments as PaymentInput[],
      dueCentavos: o.totalCentavos,
      userId: cashierId,
      shiftId,
      offline: true,
    });
  }

  for (const c of conflicts) {
    await tx.syncConflict.create({ data: { orderId: order.id, type: c.type, details: c.details } });
  }
  await audit(tx, {
    userId: user.id,
    action: 'ORDER_SYNCED',
    entity: 'Order',
    entityId: order.id,
    details: { deviceId, tempReference: o.tempReference, reference, conflicts: conflicts.map((c) => c.type) },
  });

  return { orderId: order.id, reference, conflicts: conflicts.map((c) => c.type) };
}

/**
 * Process a batch of offline orders. Each order is its own transaction, so one bad order
 * never blocks or rolls back the others. Re-sending an order (lost response, retries) is safe:
 * the clientId unique key makes the second attempt return the first result.
 */
export async function syncOrders(user: ActingUser, deviceId: string, rawOrders: unknown[]): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const raw of rawOrders) {
    const parsed = OfflineOrderSchema.safeParse(raw);
    if (!parsed.success) {
      const clientId = typeof (raw as { clientId?: unknown })?.clientId === 'string' ? (raw as { clientId: string }).clientId : null;
      results.push({
        clientId,
        status: 'FAILED',
        retryable: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid order data', details: parsed.error.issues.slice(0, 5) },
      });
      continue;
    }
    const o = parsed.data;
    const dup = await existingResult(o.clientId);
    if (dup) {
      results.push(dup);
      continue;
    }
    try {
      const r = await withTx((tx) => syncOne(tx, user, deviceId, o));
      results.push({ clientId: o.clientId, status: 'SYNCED', duplicate: false, ...r });
    } catch (e) {
      // A concurrent request may have inserted the same clientId first.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await existingResult(o.clientId);
        if (again) {
          results.push(again);
          continue;
        }
      }
      if (e instanceof NonRetryable) {
        results.push({ clientId: o.clientId, status: 'FAILED', retryable: false, error: { code: e.code, message: e.message, details: e.details } });
      } else if (e instanceof AppError) {
        results.push({ clientId: o.clientId, status: 'FAILED', retryable: e.status >= 500, error: { code: e.code, message: e.message, details: e.details } });
      } else {
        console.error('[sync] unexpected error', e);
        results.push({ clientId: o.clientId, status: 'FAILED', retryable: true, error: { code: 'SERVER_ERROR', message: 'Temporary server error, will retry' } });
      }
    }
  }
  return results;
}

export { orderInclude };
