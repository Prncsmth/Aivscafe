import type { Db, Tx } from '../lib/prisma';
import { conflict, forbidden, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { getSettings } from '../lib/settings';
import { expectedCash } from './order.rules';
import type { ActingUser } from './order.service';

export async function shiftSummary(db: Db, shiftId: string) {
  const shift = await db.cashShift.findUnique({
    where: { id: shiftId },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!shift) throw notFound('Shift');

  // Independent aggregates run in parallel (each is a network round-trip to the database).
  const [pays, moves, sales, voided, openOrders] = await Promise.all([
    db.payment.groupBy({ by: ['method', 'kind', 'verification'], where: { shiftId }, _sum: { amountCentavos: true } }),
    db.cashMovement.groupBy({ by: ['type'], where: { shiftId }, _sum: { amountCentavos: true } }),
    db.order.aggregate({ where: { shiftId, status: { notIn: ['CANCELLED', 'VOIDED'] } }, _sum: { totalCentavos: true }, _count: true }),
    db.order.count({ where: { shiftId, status: { in: ['CANCELLED', 'VOIDED'] } } }),
    db.order.count({ where: { shiftId, status: { in: ['PENDING', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] } } }),
  ]);
  const sumOf = (method: 'CASH' | 'GCASH', kind: 'PAYMENT' | 'REFUND', verification?: 'VERIFIED' | 'UNVERIFIED') =>
    pays
      .filter((p) => p.method === method && p.kind === kind && (!verification || p.verification === verification))
      .reduce((s, p) => s + (p._sum.amountCentavos ?? 0), 0);

  const cashIn = moves.find((m) => m.type === 'CASH_IN')?._sum.amountCentavos ?? 0;
  const cashOut = moves.find((m) => m.type === 'CASH_OUT')?._sum.amountCentavos ?? 0;


  const cashPayments = sumOf('CASH', 'PAYMENT');
  const cashRefunds = sumOf('CASH', 'REFUND');
  const gcashPayments = sumOf('GCASH', 'PAYMENT');
  const gcashRefunds = sumOf('GCASH', 'REFUND');

  return {
    shift,
    cashPaymentsCentavos: cashPayments,
    cashRefundsCentavos: cashRefunds,
    cashInCentavos: cashIn,
    cashOutCentavos: cashOut,
    expectedCashCentavos: expectedCash({ startingCash: shift.startingCashCentavos, cashPayments, cashRefunds, cashIn, cashOut }),
    gcashPaymentsCentavos: gcashPayments,
    gcashRefundsCentavos: gcashRefunds,
    gcashUnverifiedCentavos: sumOf('GCASH', 'PAYMENT', 'UNVERIFIED'),
    expectedGcashCentavos: gcashPayments - gcashRefunds,
    totalSalesCentavos: sales._sum.totalCentavos ?? 0,
    orderCount: sales._count,
    cancelledOrVoidedCount: voided,
    openOrderCount: openOrders,
  };
}

export async function openShift(tx: Tx, user: ActingUser, startingCashCentavos: number, notes?: string | null) {
  const existing = await tx.cashShift.findUnique({ where: { openKey: user.id } });
  if (existing) throw conflict('SHIFT_ALREADY_OPEN', 'You already have an open shift');
  const shift = await tx.cashShift.create({
    data: { userId: user.id, openKey: user.id, startingCashCentavos, notes: notes ?? null },
  });
  await audit(tx, { userId: user.id, action: 'SHIFT_OPENED', entity: 'CashShift', entityId: shift.id, details: { startingCashCentavos } });
  return shift;
}

export async function addCashMovement(
  tx: Tx,
  user: ActingUser,
  args: { type: 'CASH_IN' | 'CASH_OUT'; amountCentavos: number; reason: string },
) {
  const shift = await tx.cashShift.findUnique({ where: { openKey: user.id } });
  if (!shift) throw conflict('NO_OPEN_SHIFT', 'Open a shift first');
  const m = await tx.cashMovement.create({ data: { shiftId: shift.id, userId: user.id, ...args } });
  await audit(tx, { userId: user.id, action: args.type, entity: 'CashShift', entityId: shift.id, details: args });
  return m;
}

export async function closeShift(
  tx: Tx,
  user: ActingUser,
  shiftId: string,
  args: { countedCashCentavos: number; reportedGcashCentavos?: number | null; notes?: string | null },
) {
  const shift = await tx.cashShift.findUnique({ where: { id: shiftId } });
  if (!shift) throw notFound('Shift');
  if (shift.status === 'CLOSED') throw conflict('SHIFT_CLOSED', 'This shift is already closed');
  if (shift.userId !== user.id && user.role !== 'OWNER') throw forbidden('You can only close your own shift');

  const summary = await shiftSummary(tx, shiftId);
  const settings = await getSettings(tx);
  const variance = args.countedCashCentavos - summary.expectedCashCentavos;
  const gcashGap = args.reportedGcashCentavos != null ? args.reportedGcashCentavos - summary.expectedGcashCentavos : 0;
  const needsReview =
    Math.abs(variance) > settings.cashVarianceReviewThresholdCentavos ||
    Math.abs(gcashGap) > settings.cashVarianceReviewThresholdCentavos ||
    summary.gcashUnverifiedCentavos > 0;

  const closed = await tx.cashShift.updateMany({
    where: { id: shiftId, status: 'OPEN' },
    data: {
      status: 'CLOSED',
      openKey: null,
      closedAt: new Date(),
      expectedCashCentavos: summary.expectedCashCentavos,
      countedCashCentavos: args.countedCashCentavos,
      cashVarianceCentavos: variance,
      expectedGcashCentavos: summary.expectedGcashCentavos,
      reportedGcashCentavos: args.reportedGcashCentavos ?? null,
      notes: args.notes ?? shift.notes,
      reviewStatus: needsReview ? 'PENDING_REVIEW' : 'NOT_REQUIRED',
    },
  });
  if (closed.count === 0) throw conflict('SHIFT_CLOSED', 'This shift is already closed');
  await audit(tx, {
    userId: user.id,
    action: 'SHIFT_CLOSED',
    entity: 'CashShift',
    entityId: shiftId,
    details: { expected: summary.expectedCashCentavos, counted: args.countedCashCentavos, variance, gcashGap, needsReview },
  });
  return shiftSummary(tx, shiftId);
}

export async function reviewShift(tx: Tx, user: ActingUser, shiftId: string, note: string) {
  const shift = await tx.cashShift.findUnique({ where: { id: shiftId } });
  if (!shift) throw notFound('Shift');
  if (shift.status !== 'CLOSED') throw conflict('SHIFT_OPEN', 'Only closed shifts can be reviewed');
  const updated = await tx.cashShift.update({
    where: { id: shiftId },
    data: { reviewStatus: 'REVIEWED', reviewedById: user.id, reviewedAt: new Date(), reviewNote: note },
  });
  await audit(tx, { userId: user.id, action: 'SHIFT_REVIEWED', entity: 'CashShift', entityId: shiftId, details: { note } });
  return updated;
}
