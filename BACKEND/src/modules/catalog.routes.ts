import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, withTx, type Db } from '../lib/prisma';
import { ok } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { bumpCatalogVersion, getCatalogVersion } from '../lib/settings';
import { parseBody, parseParams, parseQuery } from '../middleware/validate';
import { currentUser, ownerOnly } from '../middleware/auth';
import { IdParams, money, optionalText, quantity } from './common';

const router = Router();

type StockLevel = 'OK' | 'LOW' | 'OUT' | 'NO_RECIPE';

/** Per-variant stock status from recipes — no cost data, safe for cashiers. */
async function variantStock(db: Db, variantIds: string[]) {
  const items = await db.recipeItem.findMany({
    where: { variantId: { in: variantIds } },
    include: { ingredient: { select: { stockQty: true, lowStockThreshold: true, name: true } } },
  });
  const result = new Map<string, { level: StockLevel; maxServings: number | null; limitedBy: string | null }>();
  for (const id of variantIds) result.set(id, { level: 'NO_RECIPE', maxServings: null, limitedBy: null });
  for (const r of items) {
    if (!r.variantId || r.quantity.lte(0)) continue;
    const cur = result.get(r.variantId)!;
    const servings = Prisma.Decimal.max(r.ingredient.stockQty, 0).div(r.quantity).floor().toNumber();
    const low = r.ingredient.stockQty.lte(r.ingredient.lowStockThreshold);
    const level: StockLevel = servings < 1 ? 'OUT' : low ? 'LOW' : 'OK';
    // The worst ingredient decides the variant's level.
    const rank = { NO_RECIPE: 0, OK: 1, LOW: 2, OUT: 3 } as const;
    const nextLevel = rank[level] > rank[cur.level] ? level : cur.level;
    const limited = cur.maxServings == null || servings < cur.maxServings;
    result.set(r.variantId, {
      level: nextLevel,
      maxServings: limited ? servings : cur.maxServings,
      limitedBy: limited ? r.ingredient.name : cur.limitedBy,
    });
  }
  return result;
}

/** POS catalog for all signed-in users. Cached by the frontend for offline use. */
router.get('/catalog', async (_req, res) => {
  const [version, categories, deliveryAreas] = await Promise.all([
    getCatalogVersion(prisma),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        products: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            variants: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { priceCentavos: 'asc' }] },
            modifiers: { include: { modifier: true } },
          },
        },
      },
    }),
    prisma.deliveryArea.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
  ]);
  const stock = await variantStock(prisma, categories.flatMap((c) => c.products.flatMap((p) => p.variants.map((v) => v.id))));
  ok(res, {
    version,
    generatedAt: new Date().toISOString(),
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      products: c.products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        imageUrl: p.imageUrl,
        isAvailable: p.isAvailable,
        variants: p.variants.map((v) => ({
          id: v.id,
          name: v.name,
          priceCentavos: v.priceCentavos,
          isAvailable: v.isAvailable,
          stock: stock.get(v.id),
        })),
        modifiers: p.modifiers
          .filter((pm) => pm.modifier.isActive)
          .map((pm) => ({ id: pm.modifier.id, name: pm.modifier.name, priceCentavos: pm.modifier.priceCentavos })),
      })),
    })),
    deliveryAreas: deliveryAreas.map((a) => ({ id: a.id, name: a.name, feeCentavos: a.feeCentavos })),
  });
});

// ───────────────────── Owner: management endpoints ─────────────────────

router.get('/catalog/admin', ownerOnly, async (req, res) => {
  const { includeArchived } = parseQuery(z.object({ includeArchived: z.enum(['true', 'false']).optional() }), req.query);
  const archived = includeArchived === 'true';
  const [categories, modifiers] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        products: {
          where: archived ? {} : { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            variants: {
              where: archived ? {} : { isActive: true },
              orderBy: [{ sortOrder: 'asc' }, { priceCentavos: 'asc' }],
              include: { recipeItems: { include: { ingredient: { select: { id: true, name: true, baseUnit: true, avgUnitCost: true } } } } },
            },
            modifiers: { select: { modifierId: true } },
          },
        },
      },
    }),
    prisma.modifier.findMany({
      orderBy: { name: 'asc' },
      include: { recipeItems: { include: { ingredient: { select: { id: true, name: true, baseUnit: true, avgUnitCost: true } } } } },
    }),
  ]);
  ok(res, { version: await getCatalogVersion(prisma), categories, modifiers });
});

// Categories
const CategoryBody = z.object({
  name: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

router.post('/categories', ownerOnly, async (req, res) => {
  const me = currentUser(req);
  const body = parseBody(CategoryBody, req.body);
  const cat = await withTx(async (tx) => {
    const c = await tx.category.create({ data: body });
    await bumpCatalogVersion(tx);
    await audit(tx, { userId: me.id, action: 'CATEGORY_CREATED', entity: 'Category', entityId: c.id, details: body });
    return c;
  });
  ok(res, cat, 201);
});

router.patch('/categories/:id', ownerOnly, async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const body = parseBody(CategoryBody.partial(), req.body);
  const cat = await withTx(async (tx) => {
    const c = await tx.category.update({ where: { id }, data: body });
    await bumpCatalogVersion(tx);
    await audit(tx, { userId: me.id, action: 'CATEGORY_UPDATED', entity: 'Category', entityId: id, details: body });
    return c;
  });
  ok(res, cat);
});

// Products
const VariantBody = z.object({
  name: z.string().trim().min(1).max(60),
  priceCentavos: money,
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isAvailable: z.boolean().optional(),
});

const ProductBody = z.object({
  categoryId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: optionalText(500),
  imageUrl: z.string().url().max(500).nullable().optional(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  modifierIds: z.array(z.string().min(1)).max(50).optional(),
});

router.post('/products', ownerOnly, async (req, res) => {
  const me = currentUser(req);
  const body = parseBody(ProductBody.extend({ variants: z.array(VariantBody).min(1).max(20) }), req.body);
  const names = body.variants.map((v) => v.name.toLowerCase());
  if (new Set(names).size !== names.length) throw badRequest('Variant names must be unique within a product');
  const product = await withTx(async (tx) => {
    const p = await tx.product.create({
      data: {
        categoryId: body.categoryId,
        name: body.name,
        description: body.description ?? null,
        imageUrl: body.imageUrl ?? null,
        isAvailable: body.isAvailable ?? true,
        sortOrder: body.sortOrder ?? 0,
        variants: { create: body.variants.map((v, i) => ({ ...v, sortOrder: v.sortOrder ?? i })) },
        modifiers: body.modifierIds?.length ? { create: body.modifierIds.map((modifierId) => ({ modifierId })) } : undefined,
      },
      include: { variants: true, modifiers: true },
    });
    await bumpCatalogVersion(tx);
    await audit(tx, { userId: me.id, action: 'PRODUCT_CREATED', entity: 'Product', entityId: p.id, details: body });
    return p;
  });
  ok(res, product, 201);
});

router.patch('/products/:id', ownerOnly, async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const body = parseBody(ProductBody.partial().extend({ isActive: z.boolean().optional() }), req.body);
  const product = await withTx(async (tx) => {
    const before = await tx.product.findUnique({ where: { id } });
    if (!before) throw notFound('Product');
    const { modifierIds, ...data } = body;
    if (modifierIds) {
      await tx.productModifier.deleteMany({ where: { productId: id } });
      if (modifierIds.length) await tx.productModifier.createMany({ data: modifierIds.map((modifierId) => ({ productId: id, modifierId })) });
    }
    const p = await tx.product.update({ where: { id }, data, include: { variants: true, modifiers: true } });
    await bumpCatalogVersion(tx);
    await audit(tx, { userId: me.id, action: body.isActive === false ? 'PRODUCT_ARCHIVED' : 'PRODUCT_UPDATED', entity: 'Product', entityId: id, details: body });
    return p;
  });
  ok(res, product);
});

router.post('/products/:id/variants', ownerOnly, async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const body = parseBody(VariantBody, req.body);
  const v = await withTx(async (tx) => {
    const created = await tx.productVariant.create({ data: { ...body, productId: id } });
    await bumpCatalogVersion(tx);
    await audit(tx, { userId: me.id, action: 'VARIANT_CREATED', entity: 'ProductVariant', entityId: created.id, details: body });
    return created;
  });
  ok(res, v, 201);
});

router.patch('/variants/:id', ownerOnly, async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const body = parseBody(VariantBody.partial().extend({ isActive: z.boolean().optional() }), req.body);
  const v = await withTx(async (tx) => {
    const before = await tx.productVariant.findUnique({ where: { id } });
    if (!before) throw notFound('Variant');
    const updated = await tx.productVariant.update({ where: { id }, data: body });
    await bumpCatalogVersion(tx);
    await audit(tx, {
      userId: me.id,
      action: body.priceCentavos != null && body.priceCentavos !== before.priceCentavos ? 'PRICE_CHANGED' : 'VARIANT_UPDATED',
      entity: 'ProductVariant',
      entityId: id,
      details: { before: { name: before.name, priceCentavos: before.priceCentavos }, after: body },
    });
    return updated;
  });
  ok(res, v);
});

const RecipeBody = z.object({
  items: z
    .array(z.object({ ingredientId: z.string().min(1), quantity }))
    .max(50)
    .refine((items) => new Set(items.map((i) => i.ingredientId)).size === items.length, 'Each ingredient may appear once'),
});

async function replaceRecipe(owner: { variantId?: string; modifierId?: string }, items: { ingredientId: string; quantity: string }[], userId: string) {
  return withTx(async (tx) => {
    for (const it of items) {
      if (new Prisma.Decimal(it.quantity).lte(0)) throw badRequest('Recipe quantities must be greater than zero');
    }
    const found = await tx.ingredient.count({ where: { id: { in: items.map((i) => i.ingredientId) } } });
    if (found !== items.length) throw badRequest('One or more ingredients do not exist');
    await tx.recipeItem.deleteMany({ where: owner });
    if (items.length) {
      await tx.recipeItem.createMany({ data: items.map((i) => ({ ...owner, ingredientId: i.ingredientId, quantity: new Prisma.Decimal(i.quantity) })) });
    }
    await audit(tx, { userId, action: 'RECIPE_UPDATED', entity: owner.variantId ? 'ProductVariant' : 'Modifier', entityId: owner.variantId ?? owner.modifierId, details: { items } });
    return tx.recipeItem.findMany({ where: owner, include: { ingredient: { select: { id: true, name: true, baseUnit: true } } } });
  });
}

router.put('/variants/:id/recipe', ownerOnly, async (req, res) => {
  const { id } = parseParams(IdParams, req.params);
  const { items } = parseBody(RecipeBody, req.body);
  if (!(await prisma.productVariant.findUnique({ where: { id } }))) throw notFound('Variant');
  ok(res, await replaceRecipe({ variantId: id }, items, currentUser(req).id));
});

// Modifiers / add-ons
const ModifierBody = z.object({
  name: z.string().trim().min(1).max(80),
  priceCentavos: money,
  isActive: z.boolean().optional(),
});

router.post('/modifiers', ownerOnly, async (req, res) => {
  const me = currentUser(req);
  const body = parseBody(ModifierBody, req.body);
  const m = await withTx(async (tx) => {
    const created = await tx.modifier.create({ data: body });
    await bumpCatalogVersion(tx);
    await audit(tx, { userId: me.id, action: 'MODIFIER_CREATED', entity: 'Modifier', entityId: created.id, details: body });
    return created;
  });
  ok(res, m, 201);
});

router.patch('/modifiers/:id', ownerOnly, async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const body = parseBody(ModifierBody.partial(), req.body);
  const m = await withTx(async (tx) => {
    const before = await tx.modifier.findUnique({ where: { id } });
    if (!before) throw notFound('Modifier');
    const updated = await tx.modifier.update({ where: { id }, data: body });
    await bumpCatalogVersion(tx);
    await audit(tx, { userId: me.id, action: 'MODIFIER_UPDATED', entity: 'Modifier', entityId: id, details: { before, after: body } });
    return updated;
  });
  ok(res, m);
});

router.put('/modifiers/:id/recipe', ownerOnly, async (req, res) => {
  const { id } = parseParams(IdParams, req.params);
  const { items } = parseBody(RecipeBody, req.body);
  if (!(await prisma.modifier.findUnique({ where: { id } }))) throw notFound('Modifier');
  ok(res, await replaceRecipe({ modifierId: id }, items, currentUser(req).id));
});

export default router;
