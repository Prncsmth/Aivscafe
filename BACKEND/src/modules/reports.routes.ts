import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ok } from '../lib/http';
import { badRequest } from '../lib/errors';
import { addDays, businessDay, businessRange } from '../lib/time';
import { parseQuery } from '../middleware/validate';
import { currentUser, ownerOnly } from '../middleware/auth';
import { expiringBatches, inventoryConsumption, lowStock, salesReport } from '../services/report.service';
import { shiftSummary } from '../services/shift.service';
import { orderInclude } from '../services/order.service';
import { day } from './common';

const router = Router();

const RangeQuery = z.object({ from: day, to: day }).refine((q) => q.from <= q.to, 'from must be before to');

function checkRange(from: string, to: string) {
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days > 366) throw badRequest('Range cannot exceed one year');
}

router.get('/reports/sales', ownerOnly, async (req, res) => {
  const { from, to } = parseQuery(RangeQuery, req.query);
  checkRange(from, to);
  ok(res, await salesReport(prisma, from, to));
});

router.get('/reports/inventory-consumption', ownerOnly, async (req, res) => {
  const { from, to } = parseQuery(RangeQuery, req.query);
  checkRange(from, to);
  ok(res, await inventoryConsumption(prisma, from, to));
});

router.get('/reports/waste', ownerOnly, async (req, res) => {
  const { from, to } = parseQuery(RangeQuery, req.query);
  checkRange(from, to);
  ok(
    res,
    await prisma.inventoryMovement.findMany({
      where: { type: 'WASTE', createdAt: businessRange(from, to) },
      orderBy: { createdAt: 'desc' },
      include: { ingredient: { select: { name: true, baseUnit: true } }, user: { select: { name: true } } },
    }),
  );
});

router.get('/reports/shifts', ownerOnly, async (req, res) => {
  const { from, to } = parseQuery(RangeQuery, req.query);
  checkRange(from, to);
  const shifts = await prisma.cashShift.findMany({ where: { openedAt: businessRange(from, to) }, orderBy: { openedAt: 'desc' } });
  ok(res, await Promise.all(shifts.map((s) => shiftSummary(prisma, s.id))));
});

/** Owner dashboard — every number comes from the database. */
router.get('/dashboard/owner', ownerOnly, async (_req, res) => {
  const today = businessDay();
  const [todayReport, trendReport, low, expiring, recent, openConflicts, pendingShiftReviews, unverifiedGcash] = await Promise.all([
    salesReport(prisma, today, today),
    salesReport(prisma, addDays(today, -13), today),
    lowStock(prisma),
    expiringBatches(prisma),
    prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: orderInclude }),
    prisma.syncConflict.count({ where: { status: 'OPEN' } }),
    prisma.cashShift.count({ where: { reviewStatus: 'PENDING_REVIEW' } }),
    prisma.payment.aggregate({ where: { method: 'GCASH', kind: 'PAYMENT', verification: 'UNVERIFIED' }, _sum: { amountCentavos: true }, _count: true }),
  ]);
  ok(res, {
    today: todayReport.summary,
    warnings: todayReport.warnings,
    bestSellersToday: todayReport.byProduct.slice(0, 5),
    trend: trendReport.trend,
    lowStock: low,
    expiring,
    recentOrders: recent,
    openConflicts,
    pendingShiftReviews,
    unverifiedGcash: { count: unverifiedGcash._count, amountCentavos: unverifiedGcash._sum.amountCentavos ?? 0 },
  });
});

/** Cashier dashboard — operational info only, no costs or profit. */
router.get('/dashboard/cashier', async (req, res) => {
  const me = currentUser(req);
  const shift = await prisma.cashShift.findUnique({ where: { openKey: me.id } });
  const [summary, queue, recent, low] = await Promise.all([
    shift ? shiftSummary(prisma, shift.id) : Promise.resolve(null),
    prisma.order.findMany({
      where: { status: { in: ['PENDING', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] } },
      orderBy: { createdAt: 'asc' },
      include: orderInclude,
      take: 50,
    }),
    prisma.order.findMany({ where: { cashierId: me.id }, orderBy: { createdAt: 'desc' }, take: 10, include: orderInclude }),
    lowStock(prisma),
  ]);
  ok(res, { shift: summary, queue, recentOrders: recent, lowStock: low });
});

export default router;
