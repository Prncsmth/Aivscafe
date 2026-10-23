import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, withTx } from '../lib/prisma';
import { ok, paginate } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { toBaseUnit } from '../lib/units';
import { businessRange } from '../lib/time';
import { parseBody, parseParams, parseQuery } from '../middleware/validate';
import { currentUser, ownerOnly } from '../middleware/auth';
import { adjustToCount, recordWaste, stockIn } from '../services/inventory.service';
import { expiringBatches, lowStock, stockValuation } from '../services/report.service';
import { IdParams, baseUnit, day, money, pageQuery, quantity, unit } from './common';

const router = Router();

const toDto = (i: Prisma.IngredientGetPayload<object>, includeCost: boolean) => ({
  id: i.id,
  name: i.name,
  baseUnit: i.baseUnit,
  stockQty: i.stockQty.toString(),
  lowStockThreshold: i.lowStockThreshold.toString(),
  isActive: i.isActive,
  level: i.stockQty.lte(0) ? 'OUT' : i.stockQty.lte(i.lowStockThreshold) ? 'LOW' : 'OK',
  ...(includeCost ? { avgUnitCost: i.avgUnitCost.toString() } : {}),
});

/** Cashiers see stock levels (no costs); owners see everything. */
router.get('/ingredients', async (req, res) => {
  const me = currentUser(req);
  const { includeInactive } = parseQuery(z.object({ includeInactive: z.enum(['true', 'false']).optional() }), req.query);
  const rows = await prisma.ingredient.findMany({
    where: includeInactive === 'true' && me.role === 'OWNER' ? {} : { isActive: true },
    orderBy: { name: 'asc' },
  });
  ok(res, rows.map((r) => toDto(r, me.role === 'OWNER')));
});

router.get('/inventory/low-stock', async (_req, res) => ok(res, await lowStock(prisma)));
router.get('/inventory/expiring', async (req, res) => {
  const { days } = parseQuery(z.object({ days: z.coerce.number().int().min(0).max(365).optional() }), req.query);
  ok(res, await expiringBatches(prisma, days));
});

const CreateIngredient = z.object({
  name: z.string().trim().min(1).max(120),
  baseUnit,
  lowStockThreshold: quantity.optional(),
  /** Optional opening stock, entered in any compatible unit */
  opening: z
    .object({
      quantity,
      unit,
      totalCostCentavos: money,
      expiryDate: z.coerce.date().nullable().optional(),
    })
    .optional(),
});

router.post('/ingredients', ownerOnly, async (req, res) => {
  const me = currentUser(req);
  const body = parseBody(CreateIngredient, req.body);
  const ing = await withTx(async (tx) => {
    const created = await tx.ingredient.create({
      data: {
        name: body.name,
        baseUnit: body.baseUnit,
        lowStockThreshold: new Prisma.Decimal(body.lowStockThreshold ?? 0),
      },
    });
    if (body.opening && new Prisma.Decimal(body.opening.quantity).gt(0)) {
      let base;
      try {
        base = toBaseUnit(body.opening.quantity, body.opening.unit, body.baseUnit);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
      await stockIn(tx, {
        ingredientId: created.id,
        baseQuantity: base,
        totalCostCentavos: body.opening.totalCostCentavos,
        type: 'OPENING',
        expiryDate: body.opening.expiryDate ?? null,
        userId: me.id,
        reason: 'Opening stock',
      });
    }
    await audit(tx, { userId: me.id, action: 'INGREDIENT_CREATED', entity: 'Ingredient', entityId: created.id, details: body });
    return tx.ingredient.findUniqueOrThrow({ where: { id: created.id } });
  });
  ok(res, toDto(ing, true), 201);
});

const UpdateIngredient = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  lowStockThreshold: quantity.optional(),
  isActive: z.boolean().optional(),
});

router.patch('/ingredients/:id', ownerOnly, async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const body = parseBody(UpdateIngredient, req.body);
  const ing = await prisma.ingredient.update({
    where: { id },
    data: {
      name: body.name,
      isActive: body.isActive,
      lowStockThreshold: body.lowStockThreshold != null ? new Prisma.Decimal(body.lowStockThreshold) : undefined,
    },
  });
  await audit(prisma, { userId: me.id, action: 'INGREDIENT_UPDATED', entity: 'Ingredient', entityId: id, details: body });
  ok(res, toDto(ing, true));
});

const AdjustBody = z.object({
  countedQuantity: quantity,
  unit: unit.optional(),
  reason: z.string().trim().min(3).max(300),
});

/** Physical stock count. Owner only — this can hide losses, so it is always audited. */
router.post('/ingredients/:id/adjust', ownerOnly, async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const body = parseBody(AdjustBody, req.body);
  const movement = await withTx(async (tx) => {
    const ing = await tx.ingredient.findUnique({ where: { id } });
    if (!ing) throw notFound('Ingredient');
    let counted;
    try {
      counted = toBaseUnit(body.countedQuantity, body.unit ?? ing.baseUnit, ing.baseUnit);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    if (counted.lt(0)) throw badRequest('Counted quantity cannot be negative');
    const m = await adjustToCount(tx, { ingredientId: id, countedQuantity: counted, reason: body.reason, userId: me.id });
    await audit(tx, { userId: me.id, action: 'STOCK_ADJUSTED', entity: 'Ingredient', entityId: id, details: { ...body, before: ing.stockQty.toString(), after: counted.toString() } });
    return m;
  });
  ok(res, { movement });
});

const WasteBody = z.object({
  quantity,
  unit: unit.optional(),
  reason: z.string().trim().min(3).max(300),
  batchId: z.string().optional(),
});

/** Waste & spoilage — cashiers may record it (they see it happen), always audited. */
router.post('/ingredients/:id/waste', async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const body = parseBody(WasteBody, req.body);
  const movement = await withTx(async (tx) => {
    const ing = await tx.ingredient.findUnique({ where: { id } });
    if (!ing) throw notFound('Ingredient');
    let qty;
    try {
      qty = toBaseUnit(body.quantity, body.unit ?? ing.baseUnit, ing.baseUnit);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    const m = await recordWaste(tx, { ingredientId: id, baseQuantity: qty, reason: body.reason, userId: me.id, batchId: body.batchId });
    await audit(tx, { userId: me.id, action: 'WASTE_RECORDED', entity: 'Ingredient', entityId: id, details: body });
    return m;
  });
  ok(res, { movement }, 201);
});

router.get('/ingredients/:id/batches', ownerOnly, async (req, res) => {
  const { id } = parseParams(IdParams, req.params);
  ok(res, await prisma.inventoryBatch.findMany({ where: { ingredientId: id }, orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }] }));
});

const MovementQuery = z.object({
  ingredientId: z.string().optional(),
  type: z.enum(['OPENING', 'PURCHASE', 'SALE', 'SALE_REVERSAL', 'ADJUSTMENT', 'WASTE']).optional(),
  from: day.optional(),
  to: day.optional(),
  ...pageQuery,
});

router.get('/inventory/movements', ownerOnly, async (req, res) => {
  const q = parseQuery(MovementQuery, req.query);
  const { skip, take, page, pageSize } = paginate(q);
  const where: Prisma.InventoryMovementWhereInput = {
    ingredientId: q.ingredientId,
    type: q.type,
    createdAt: q.from && q.to ? businessRange(q.from, q.to) : undefined,
  };
  const [rows, total] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        ingredient: { select: { name: true, baseUnit: true } },
        user: { select: { name: true } },
        order: { select: { reference: true } },
      },
    }),
    prisma.inventoryMovement.count({ where }),
  ]);
  ok(res, rows, 200, { page, pageSize, total });
});

router.get('/inventory/valuation', ownerOnly, async (_req, res) => ok(res, await stockValuation(prisma)));

export default router;
