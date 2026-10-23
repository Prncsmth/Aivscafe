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
import { stockIn } from '../services/inventory.service';
import { IdParams, day, money, optionalText, pageQuery, quantity, unit } from './common';

const router = Router();
router.use(['/suppliers', '/purchases'], ownerOnly);

// Suppliers
const SupplierBody = z.object({
  name: z.string().trim().min(1).max(120),
  contact: optionalText(120),
  phone: optionalText(40),
  notes: optionalText(500),
  isActive: z.boolean().optional(),
});

router.get('/suppliers', async (_req, res) => {
  ok(res, await prisma.supplier.findMany({ orderBy: { name: 'asc' } }));
});

router.post('/suppliers', async (req, res) => {
  const me = currentUser(req);
  const body = parseBody(SupplierBody, req.body);
  const s = await prisma.supplier.create({ data: body });
  await audit(prisma, { userId: me.id, action: 'SUPPLIER_CREATED', entity: 'Supplier', entityId: s.id, details: body });
  ok(res, s, 201);
});

router.patch('/suppliers/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const body = parseBody(SupplierBody.partial(), req.body);
  const s = await prisma.supplier.update({ where: { id }, data: body });
  await audit(prisma, { userId: me.id, action: 'SUPPLIER_UPDATED', entity: 'Supplier', entityId: id, details: body });
  ok(res, s);
});

// Purchases (stock-in)
const PurchaseBody = z.object({
  supplierId: z.string().nullable().optional(),
  reference: optionalText(80),
  purchasedAt: z.coerce.date().optional(),
  notes: optionalText(500),
  items: z
    .array(
      z.object({
        ingredientId: z.string().min(1),
        quantity,
        unit,
        totalCostCentavos: money,
        expiryDate: z.coerce.date().nullable().optional(),
        batchCode: optionalText(60),
      }),
    )
    .min(1)
    .max(100),
});

/**
 * Records a purchase and receives the stock in one transaction.
 * Purchases are inventory (asset), not operating expenses: their cost reaches the
 * P&L as COGS when the ingredients are consumed by sales.
 */
router.post('/purchases', async (req, res) => {
  const me = currentUser(req);
  const body = parseBody(PurchaseBody, req.body);
  const purchase = await withTx(async (tx) => {
    const ingredients = await tx.ingredient.findMany({ where: { id: { in: body.items.map((i) => i.ingredientId) } } });
    const byId = new Map(ingredients.map((i) => [i.id, i]));
    const converted = body.items.map((it, idx) => {
      const ing = byId.get(it.ingredientId);
      if (!ing) throw badRequest(`Item ${idx + 1}: ingredient not found`);
      let base;
      try {
        base = toBaseUnit(it.quantity, it.unit, ing.baseUnit);
      } catch (e) {
        throw badRequest(`Item ${idx + 1} (${ing.name}): ${(e as Error).message}`);
      }
      if (base.lte(0)) throw badRequest(`Item ${idx + 1}: quantity must be greater than zero`);
      return { ...it, baseQuantity: base };
    });
    const p = await tx.purchase.create({
      data: {
        supplierId: body.supplierId ?? null,
        reference: body.reference ?? null,
        purchasedAt: body.purchasedAt ?? new Date(),
        notes: body.notes ?? null,
        userId: me.id,
        totalCentavos: converted.reduce((s, i) => s + i.totalCostCentavos, 0),
      },
    });
    for (const it of converted) {
      const item = await tx.purchaseItem.create({
        data: {
          purchaseId: p.id,
          ingredientId: it.ingredientId,
          quantity: new Prisma.Decimal(it.quantity),
          unit: it.unit,
          baseQuantity: it.baseQuantity,
          totalCostCentavos: it.totalCostCentavos,
          expiryDate: it.expiryDate ?? null,
          batchCode: it.batchCode ?? null,
        },
      });
      await stockIn(tx, {
        ingredientId: it.ingredientId,
        baseQuantity: it.baseQuantity,
        totalCostCentavos: it.totalCostCentavos,
        type: 'PURCHASE',
        expiryDate: it.expiryDate ?? null,
        batchCode: it.batchCode ?? null,
        purchaseId: p.id,
        purchaseItemId: item.id,
        userId: me.id,
      });
    }
    await audit(tx, { userId: me.id, action: 'PURCHASE_RECORDED', entity: 'Purchase', entityId: p.id, details: { total: p.totalCentavos, items: body.items.length } });
    return tx.purchase.findUniqueOrThrow({ where: { id: p.id }, include: { items: { include: { ingredient: { select: { name: true, baseUnit: true } } } }, supplier: true } });
  });
  ok(res, purchase, 201);
});

router.get('/purchases', async (req, res) => {
  const q = parseQuery(z.object({ from: day.optional(), to: day.optional(), supplierId: z.string().optional(), ...pageQuery }), req.query);
  const { skip, take, page, pageSize } = paginate(q);
  const where: Prisma.PurchaseWhereInput = {
    supplierId: q.supplierId,
    purchasedAt: q.from && q.to ? businessRange(q.from, q.to) : undefined,
  };
  const [rows, total] = await Promise.all([
    prisma.purchase.findMany({
      where,
      orderBy: { purchasedAt: 'desc' },
      skip,
      take,
      include: { supplier: { select: { name: true } }, items: { include: { ingredient: { select: { name: true, baseUnit: true } } } }, user: { select: { name: true } } },
    }),
    prisma.purchase.count({ where }),
  ]);
  ok(res, rows, 200, { page, pageSize, total });
});

router.get('/purchases/:id', async (req, res) => {
  const { id } = parseParams(IdParams, req.params);
  const p = await prisma.purchase.findUnique({ where: { id }, include: { supplier: true, items: { include: { ingredient: true } } } });
  if (!p) throw notFound('Purchase');
  ok(res, p);
});

export default router;
