import { MovementType, Prisma } from '@prisma/client';
import type { Tx } from '../lib/prisma';
import { conflict, notFound } from '../lib/errors';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export interface RequirementLine {
  variantId: string;
  modifierIds: string[];
  quantity: number;
}

export interface Shortage {
  ingredientId: string;
  name: string;
  baseUnit: string;
  required: string;
  available: string;
}

/**
 * Ingredient requirements for a set of sold lines, from the configured recipes.
 * Returns ingredientId -> total base-unit quantity.
 */
export async function computeRequirements(tx: Tx, lines: RequirementLine[]): Promise<Map<string, Decimal>> {
  const variantIds = [...new Set(lines.map((l) => l.variantId))];
  const modifierIds = [...new Set(lines.flatMap((l) => l.modifierIds))];
  const recipeItems = await tx.recipeItem.findMany({
    where: {
      OR: [{ variantId: { in: variantIds } }, ...(modifierIds.length ? [{ modifierId: { in: modifierIds } }] : [])],
    },
  });
  const byVariant = new Map<string, typeof recipeItems>();
  const byModifier = new Map<string, typeof recipeItems>();
  for (const r of recipeItems) {
    if (r.variantId) byVariant.set(r.variantId, [...(byVariant.get(r.variantId) ?? []), r]);
    if (r.modifierId) byModifier.set(r.modifierId, [...(byModifier.get(r.modifierId) ?? []), r]);
  }
  const totals = new Map<string, Decimal>();
  const add = (ingredientId: string, qty: Decimal) =>
    totals.set(ingredientId, (totals.get(ingredientId) ?? new D(0)).add(qty));
  for (const line of lines) {
    for (const r of byVariant.get(line.variantId) ?? []) add(r.ingredientId, r.quantity.mul(line.quantity));
    for (const m of line.modifierIds) {
      for (const r of byModifier.get(m) ?? []) add(r.ingredientId, r.quantity.mul(line.quantity));
    }
  }
  return totals;
}

/** Row-lock ingredients in a stable order so concurrent orders serialise instead of deadlocking. */
async function lockIngredients(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  const sorted = [...ids].sort();
  await tx.$queryRaw`SELECT id FROM "Ingredient" WHERE id IN (${Prisma.join(sorted)}) ORDER BY id FOR UPDATE`;
}

function valueOf(quantity: Decimal, unitCost: Decimal): number {
  return quantity.mul(unitCost).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

/** Reduce batch remaining quantities first-expiry-first-out (expiry tracking only; costing is weighted average). */
async function consumeBatches(tx: Tx, ingredientId: string, quantity: Decimal, batchId?: string) {
  let left = quantity;
  const batches = await tx.inventoryBatch.findMany({
    where: { ingredientId, remainingQty: { gt: 0 }, ...(batchId ? { id: batchId } : {}) },
    orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
  });
  for (const b of batches) {
    if (left.lte(0)) break;
    const take = D.min(left, b.remainingQty);
    await tx.inventoryBatch.update({ where: { id: b.id }, data: { remainingQty: b.remainingQty.sub(take) } });
    left = left.sub(take);
  }
}

/** Put quantity back into batches that were consumed (earliest expiry first). */
async function restoreBatches(tx: Tx, ingredientId: string, quantity: Decimal) {
  let left = quantity;
  const batches = await tx.inventoryBatch.findMany({
    where: { ingredientId },
    orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
  });
  for (const b of batches) {
    if (left.lte(0)) break;
    const room = b.receivedQty.sub(b.remainingQty);
    if (room.lte(0)) continue;
    const put = D.min(left, room);
    await tx.inventoryBatch.update({ where: { id: b.id }, data: { remainingQty: b.remainingQty.add(put) } });
    left = left.sub(put);
  }
}

interface MovementInput {
  ingredientId: string;
  type: MovementType;
  /** signed base-unit quantity */
  quantity: Decimal;
  unitCost?: Decimal;
  reason?: string | null;
  orderId?: string | null;
  purchaseId?: string | null;
  userId?: string | null;
}

/** Apply one ledger movement and update running stock atomically. Caller must hold the row lock. */
async function applyMovement(tx: Tx, m: MovementInput) {
  const ing = await tx.ingredient.findUniqueOrThrow({ where: { id: m.ingredientId } });
  const unitCost = m.unitCost ?? ing.avgUnitCost;
  const stockAfter = ing.stockQty.add(m.quantity);
  const data: Prisma.IngredientUpdateInput = { stockQty: stockAfter };

  // Weighted-average cost is recalculated on stock coming in at a known cost.
  if ((m.type === 'PURCHASE' || m.type === 'OPENING') && m.quantity.gt(0)) {
    const prevQty = D.max(ing.stockQty, 0);
    const newQty = prevQty.add(m.quantity);
    data.avgUnitCost = newQty.gt(0)
      ? prevQty.mul(ing.avgUnitCost).add(m.quantity.mul(unitCost)).div(newQty).toDecimalPlaces(4)
      : unitCost;
  }

  await tx.ingredient.update({ where: { id: ing.id }, data });
  return tx.inventoryMovement.create({
    data: {
      ingredientId: m.ingredientId,
      type: m.type,
      quantity: m.quantity,
      unitCost,
      valueCentavos: valueOf(m.quantity, unitCost),
      stockAfter,
      reason: m.reason ?? null,
      orderId: m.orderId ?? null,
      purchaseId: m.purchaseId ?? null,
      userId: m.userId ?? null,
    },
  });
}

/**
 * Deduct recipe ingredients for an order exactly once.
 * - Skips if the order already has inventoryDeductedAt set.
 * - The (orderId, ingredientId, SALE) unique key is a database-level backstop.
 * - If stock is insufficient and allowNegative is false, throws INSUFFICIENT_STOCK (whole tx rolls back).
 */
export async function deductForOrder(
  tx: Tx,
  args: { orderId: string; lines: RequirementLine[]; allowNegative: boolean; userId: string },
): Promise<{ shortages: Shortage[]; deducted: boolean }> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: args.orderId }, select: { inventoryDeductedAt: true } });
  if (order.inventoryDeductedAt) return { shortages: [], deducted: false };

  const reqs = await computeRequirements(tx, args.lines);
  const ids = [...reqs.keys()];
  await lockIngredients(tx, ids);
  const ingredients = await tx.ingredient.findMany({ where: { id: { in: ids } } });

  const shortages: Shortage[] = [];
  for (const ing of ingredients) {
    const need = reqs.get(ing.id)!;
    if (ing.stockQty.lt(need)) {
      shortages.push({
        ingredientId: ing.id,
        name: ing.name,
        baseUnit: ing.baseUnit,
        required: need.toString(),
        available: ing.stockQty.toString(),
      });
    }
  }
  if (shortages.length && !args.allowNegative) {
    throw conflict('INSUFFICIENT_STOCK', 'Not enough stock for this order', { shortages });
  }

  for (const ing of ingredients) {
    const need = reqs.get(ing.id)!;
    if (need.lte(0)) continue;
    await applyMovement(tx, {
      ingredientId: ing.id,
      type: 'SALE',
      quantity: need.neg(),
      orderId: args.orderId,
      userId: args.userId,
    });
    await consumeBatches(tx, ing.id, need);
  }
  await tx.order.update({ where: { id: args.orderId }, data: { inventoryDeductedAt: new Date() } });
  return { shortages, deducted: true };
}

/**
 * Restore an order's SALE movements exactly once. Returns false if already reversed or never deducted.
 * The conditional update is the guard; the (orderId, ingredientId, SALE_REVERSAL) unique key is the backstop.
 */
export async function reverseForOrder(tx: Tx, args: { orderId: string; userId: string; reason: string }): Promise<boolean> {
  const claimed = await tx.order.updateMany({
    where: { id: args.orderId, inventoryReversedAt: null, inventoryDeductedAt: { not: null } },
    data: { inventoryReversedAt: new Date() },
  });
  if (claimed.count === 0) return false;

  const sales = await tx.inventoryMovement.findMany({ where: { orderId: args.orderId, type: 'SALE' } });
  await lockIngredients(tx, sales.map((s) => s.ingredientId));
  for (const s of sales) {
    const qty = s.quantity.neg();
    await applyMovement(tx, {
      ingredientId: s.ingredientId,
      type: 'SALE_REVERSAL',
      quantity: qty,
      unitCost: s.unitCost,
      orderId: args.orderId,
      userId: args.userId,
      reason: args.reason,
    });
    await restoreBatches(tx, s.ingredientId, qty);
  }
  return true;
}

/** Stock-in at a known total cost (purchases and opening stock). Creates a batch for expiry tracking. */
export async function stockIn(
  tx: Tx,
  args: {
    ingredientId: string;
    baseQuantity: Decimal;
    totalCostCentavos: number;
    type: 'PURCHASE' | 'OPENING';
    expiryDate?: Date | null;
    batchCode?: string | null;
    purchaseId?: string | null;
    purchaseItemId?: string | null;
    userId: string;
    reason?: string;
  },
) {
  if (args.baseQuantity.lte(0)) throw conflict('INVALID_QUANTITY', 'Quantity must be greater than zero');
  await lockIngredients(tx, [args.ingredientId]);
  const unitCost = new D(args.totalCostCentavos).div(args.baseQuantity).toDecimalPlaces(4);
  await tx.inventoryBatch.create({
    data: {
      ingredientId: args.ingredientId,
      purchaseItemId: args.purchaseItemId ?? null,
      batchCode: args.batchCode ?? null,
      receivedQty: args.baseQuantity,
      remainingQty: args.baseQuantity,
      unitCost,
      expiryDate: args.expiryDate ?? null,
    },
  });
  return applyMovement(tx, {
    ingredientId: args.ingredientId,
    type: args.type,
    quantity: args.baseQuantity,
    unitCost,
    purchaseId: args.purchaseId,
    userId: args.userId,
    reason: args.reason,
  });
}

/** Physical-count correction: sets stock to `countedQuantity` and records the difference. */
export async function adjustToCount(
  tx: Tx,
  args: { ingredientId: string; countedQuantity: Decimal; reason: string; userId: string },
) {
  await lockIngredients(tx, [args.ingredientId]);
  const ing = await tx.ingredient.findUnique({ where: { id: args.ingredientId } });
  if (!ing) throw notFound('Ingredient');
  const delta = args.countedQuantity.sub(ing.stockQty);
  if (delta.eq(0)) return null;
  const movement = await applyMovement(tx, {
    ingredientId: ing.id,
    type: 'ADJUSTMENT',
    quantity: delta,
    reason: args.reason,
    userId: args.userId,
  });
  if (delta.lt(0)) await consumeBatches(tx, ing.id, delta.neg());
  return movement;
}

/** Record waste / spoilage. Never silently allows negative stock. */
export async function recordWaste(
  tx: Tx,
  args: { ingredientId: string; baseQuantity: Decimal; reason: string; userId: string; batchId?: string },
) {
  if (args.baseQuantity.lte(0)) throw conflict('INVALID_QUANTITY', 'Quantity must be greater than zero');
  await lockIngredients(tx, [args.ingredientId]);
  const ing = await tx.ingredient.findUnique({ where: { id: args.ingredientId } });
  if (!ing) throw notFound('Ingredient');
  if (ing.stockQty.lt(args.baseQuantity)) {
    throw conflict('INSUFFICIENT_STOCK', `Only ${ing.stockQty.toString()} ${ing.baseUnit} of ${ing.name} is on record`);
  }
  if (args.batchId) {
    const batch = await tx.inventoryBatch.findFirst({ where: { id: args.batchId, ingredientId: ing.id } });
    if (!batch) throw notFound('Batch');
  }
  const movement = await applyMovement(tx, {
    ingredientId: ing.id,
    type: 'WASTE',
    quantity: args.baseQuantity.neg(),
    reason: args.reason,
    userId: args.userId,
  });
  await consumeBatches(tx, ing.id, args.baseQuantity, args.batchId);
  return movement;
}
