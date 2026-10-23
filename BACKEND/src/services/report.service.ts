import { Prisma } from '@prisma/client';
import type { Db } from '../lib/prisma';
import { addDays, businessDay, businessHour, businessRange } from '../lib/time';
import { getSettings } from '../lib/settings';

const VOID_STATUSES = ['CANCELLED', 'VOIDED'] as const;

/**
 * Profit definitions used throughout the reports (all centavos, all estimates):
 *   Gross sales            = Σ line totals of non-cancelled orders
 *   Net sales (revenue)    = gross sales − discounts
 *   Delivery fee income    = Σ delivery fees of non-cancelled orders (reported separately)
 *   COGS                   = recipe ingredients consumed by those orders × weighted-average cost
 *   Gross profit (est.)    = net sales − COGS
 *   Operating expenses     = recorded Expense entries (inventory purchases are NOT expenses — they become COGS when used)
 *   Inventory losses       = waste/spoilage + negative stock-count adjustments + ingredients of cancelled/voided orders not restored
 *   Net operating profit (est.) = gross profit + delivery fee income − operating expenses − inventory losses
 */
export async function salesReport(db: Db, fromDay: string, toDay: string) {
  const range = businessRange(fromDay, toDay);

  const orders = await db.order.findMany({
    where: { createdAt: range },
    select: {
      id: true,
      reference: true,
      type: true,
      status: true,
      source: true,
      subtotalCentavos: true,
      discountCentavos: true,
      deliveryFeeCentavos: true,
      totalCentavos: true,
      createdAt: true,
      cashier: { select: { id: true, name: true } },
      shiftId: true,
      items: {
        select: {
          productName: true,
          variantName: true,
          variantId: true,
          quantity: true,
          lineTotalCentavos: true,
          product: { select: { category: { select: { name: true } } } },
        },
      },
    },
  });
  const valid = orders.filter((o) => !(VOID_STATUSES as readonly string[]).includes(o.status));
  const validIds = new Set(valid.map((o) => o.id));
  const voidIds = orders.filter((o) => !validIds.has(o.id)).map((o) => o.id);

  // Ingredient cost of orders (SALE − SALE_REVERSAL, signed values are negative for consumption).
  // Independent queries run in parallel: each one is a round-trip to the (remote) database.
  const [orderMoves, otherMoves, expensesByCat, payments] = await Promise.all([
    db.inventoryMovement.groupBy({
      by: ['orderId'],
      where: { orderId: { in: orders.map((o) => o.id) }, type: { in: ['SALE', 'SALE_REVERSAL'] } },
      _sum: { valueCentavos: true },
    }),
    db.inventoryMovement.groupBy({ by: ['type'], where: { createdAt: range, type: { in: ['WASTE', 'ADJUSTMENT'] } }, _sum: { valueCentavos: true } }),
    db.expense.groupBy({ by: ['category'], where: { incurredAt: range }, _sum: { amountCentavos: true } }),
    db.payment.groupBy({ by: ['method', 'kind', 'verification'], where: { createdAt: range }, _sum: { amountCentavos: true }, _count: true }),
  ]);
  let cogs = 0;
  let cancelledLoss = 0;
  for (const m of orderMoves) {
    const cost = -(m._sum.valueCentavos ?? 0);
    if (m.orderId && validIds.has(m.orderId)) cogs += cost;
    else cancelledLoss += cost;
  }

  const waste = -(otherMoves.find((m) => m.type === 'WASTE')?._sum.valueCentavos ?? 0);
  const adjustmentNet = -(otherMoves.find((m) => m.type === 'ADJUSTMENT')?._sum.valueCentavos ?? 0);


  const expenses = expensesByCat.reduce((s, e) => s + (e._sum.amountCentavos ?? 0), 0);


  const grossSales = valid.reduce((s, o) => s + o.subtotalCentavos, 0);
  const discounts = valid.reduce((s, o) => s + o.discountCentavos, 0);
  const netSales = grossSales - discounts;
  const deliveryFees = valid.reduce((s, o) => s + o.deliveryFeeCentavos, 0);
  const grossProfit = netSales - cogs;
  const inventoryLosses = waste + Math.max(0, adjustmentNet) + cancelledLoss;
  const netOperatingProfit = grossProfit + deliveryFees - expenses - inventoryLosses;

  // Breakdowns
  const byProduct = new Map<string, { name: string; quantity: number; revenueCentavos: number }>();
  const byCategory = new Map<string, { name: string; quantity: number; revenueCentavos: number }>();
  const byType = new Map<string, { type: string; orders: number; revenueCentavos: number }>();
  const byCashier = new Map<string, { cashierId: string; name: string; orders: number; revenueCentavos: number }>();
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0, revenueCentavos: 0 }));
  const byDay = new Map<string, { day: string; orders: number; revenueCentavos: number }>();
  const soldVariantIds = new Set<string>();

  for (const o of valid) {
    const rev = o.totalCentavos;
    const t = byType.get(o.type) ?? { type: o.type, orders: 0, revenueCentavos: 0 };
    t.orders++; t.revenueCentavos += rev; byType.set(o.type, t);
    const c = byCashier.get(o.cashier.id) ?? { cashierId: o.cashier.id, name: o.cashier.name, orders: 0, revenueCentavos: 0 };
    c.orders++; c.revenueCentavos += rev; byCashier.set(o.cashier.id, c);
    const h = byHour[businessHour(o.createdAt)];
    h.orders++; h.revenueCentavos += rev;
    const dayKey = businessDay(o.createdAt);
    const d = byDay.get(dayKey) ?? { day: dayKey, orders: 0, revenueCentavos: 0 };
    d.orders++; d.revenueCentavos += rev; byDay.set(dayKey, d);
    for (const it of o.items) {
      const key = `${it.productName} — ${it.variantName}`;
      const p = byProduct.get(key) ?? { name: key, quantity: 0, revenueCentavos: 0 };
      p.quantity += it.quantity; p.revenueCentavos += it.lineTotalCentavos; byProduct.set(key, p);
      const catName = it.product?.category.name ?? 'Uncategorised';
      const cat = byCategory.get(catName) ?? { name: catName, quantity: 0, revenueCentavos: 0 };
      cat.quantity += it.quantity; cat.revenueCentavos += it.lineTotalCentavos; byCategory.set(catName, cat);
      if (it.variantId) soldVariantIds.add(it.variantId);
    }
  }
  // Fill empty days so trends are continuous.
  const trend: { day: string; orders: number; revenueCentavos: number }[] = [];
  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) trend.push(byDay.get(d) ?? { day: d, orders: 0, revenueCentavos: 0 });

  // Data-quality warnings: tell the owner when profit figures are incomplete.
  const warnings: string[] = [];
  const [withRecipe, zeroCost, openConflicts, negStock] = await Promise.all([
    soldVariantIds.size
      ? db.recipeItem.findMany({ where: { variantId: { in: [...soldVariantIds] } }, select: { variantId: true }, distinct: ['variantId'] })
      : Promise.resolve([]),
    db.inventoryMovement.count({ where: { orderId: { in: [...validIds] }, type: 'SALE', unitCost: new Prisma.Decimal(0) } }),
    db.syncConflict.count({ where: { status: 'OPEN', orderId: { in: orders.map((o) => o.id) } } }),
    db.ingredient.count({ where: { stockQty: { lt: 0 } } }),
  ]);
  const missing = soldVariantIds.size - withRecipe.length;
  if (missing > 0) warnings.push(`${missing} sold product size(s) have no recipe, so their ingredient cost is not included in COGS.`);
  if (zeroCost > 0) warnings.push(`${zeroCost} ingredient deduction(s) had no purchase cost on record (cost counted as ₱0).`);
  if (openConflicts > 0) warnings.push(`${openConflicts} offline-sync conflict(s) in this period are not yet reviewed.`);
  if (negStock > 0) warnings.push(`${negStock} ingredient(s) currently show negative stock; a stock count is recommended.`);

  return {
    range: { from: fromDay, to: toDay },
    summary: {
      orderCount: valid.length,
      cancelledOrVoidedCount: voidIds.length,
      offlineOrderCount: valid.filter((o) => o.source === 'OFFLINE_SYNC').length,
      grossSalesCentavos: grossSales,
      discountsCentavos: discounts,
      netSalesCentavos: netSales,
      deliveryFeesCentavos: deliveryFees,
      averageOrderValueCentavos: valid.length ? Math.round((netSales + deliveryFees) / valid.length) : 0,
      cogsCentavos: cogs,
      grossProfitCentavos: grossProfit,
      operatingExpensesCentavos: expenses,
      wasteCentavos: waste,
      stockAdjustmentLossCentavos: Math.max(0, adjustmentNet),
      cancelledOrderLossCentavos: cancelledLoss,
      inventoryLossesCentavos: inventoryLosses,
      netOperatingProfitCentavos: netOperatingProfit,
      isEstimate: true,
    },
    warnings,
    expensesByCategory: expensesByCat.map((e) => ({ category: e.category, amountCentavos: e._sum.amountCentavos ?? 0 })),
    payments: payments.map((p) => ({
      method: p.method,
      kind: p.kind,
      verification: p.verification,
      count: p._count,
      amountCentavos: p._sum.amountCentavos ?? 0,
    })),
    byProduct: [...byProduct.values()].sort((a, b) => b.quantity - a.quantity),
    byCategory: [...byCategory.values()].sort((a, b) => b.revenueCentavos - a.revenueCentavos),
    byOrderType: [...byType.values()],
    byCashier: [...byCashier.values()],
    byHour,
    trend,
  };
}

export async function inventoryConsumption(db: Db, fromDay: string, toDay: string) {
  const range = businessRange(fromDay, toDay);
  const rows = await db.inventoryMovement.groupBy({
    by: ['ingredientId', 'type'],
    where: { createdAt: range },
    _sum: { quantity: true, valueCentavos: true },
  });
  const ingredients = await db.ingredient.findMany({ select: { id: true, name: true, baseUnit: true } });
  const names = new Map(ingredients.map((i) => [i.id, i]));
  const out = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const ing = names.get(r.ingredientId);
    const row = out.get(r.ingredientId) ?? { ingredientId: r.ingredientId, name: ing?.name, baseUnit: ing?.baseUnit };
    row[r.type] = { quantity: r._sum.quantity?.toString() ?? '0', valueCentavos: r._sum.valueCentavos ?? 0 };
    out.set(r.ingredientId, row);
  }
  return [...out.values()];
}

export async function lowStock(db: Db) {
  const ings = await db.ingredient.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  return ings
    .filter((i) => i.stockQty.lte(i.lowStockThreshold) || i.stockQty.lte(0))
    .map((i) => ({
      id: i.id,
      name: i.name,
      baseUnit: i.baseUnit,
      stockQty: i.stockQty.toString(),
      lowStockThreshold: i.lowStockThreshold.toString(),
      level: i.stockQty.lte(0) ? 'OUT' : 'LOW',
    }));
}

export async function expiringBatches(db: Db, withinDays?: number) {
  const days = withinDays ?? (await getSettings(db)).expiryWarningDays;
  const until = new Date(Date.now() + days * 86_400_000);
  const batches = await db.inventoryBatch.findMany({
    where: { remainingQty: { gt: 0 }, expiryDate: { not: null, lte: until } },
    include: { ingredient: { select: { name: true, baseUnit: true } } },
    orderBy: { expiryDate: 'asc' },
  });
  const now = Date.now();
  return batches.map((b) => ({
    id: b.id,
    ingredientId: b.ingredientId,
    ingredientName: b.ingredient.name,
    baseUnit: b.ingredient.baseUnit,
    batchCode: b.batchCode,
    remainingQty: b.remainingQty.toString(),
    expiryDate: b.expiryDate,
    expired: b.expiryDate!.getTime() < now,
  }));
}

export async function stockValuation(db: Db) {
  const ings = await db.ingredient.findMany({ where: { isActive: true } });
  const items = ings.map((i) => ({
    id: i.id,
    name: i.name,
    baseUnit: i.baseUnit,
    stockQty: i.stockQty.toString(),
    avgUnitCost: i.avgUnitCost.toString(),
    valueCentavos: Prisma.Decimal.max(i.stockQty, 0).mul(i.avgUnitCost).toDecimalPlaces(0).toNumber(),
  }));
  return {
    method: 'WEIGHTED_AVERAGE_COST',
    totalCentavos: items.reduce((s, i) => s + i.valueCentavos, 0),
    items,
  };
}
