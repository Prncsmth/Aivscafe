import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, withTx } from '../lib/prisma';
import { ok, paginate } from '../lib/http';
import { audit } from '../lib/audit';
import { SettingsSchema, bumpCatalogVersion, getSettings, updateSettings } from '../lib/settings';
import { businessRange } from '../lib/time';
import { parseBody, parseParams, parseQuery } from '../middleware/validate';
import { currentUser, ownerOnly } from '../middleware/auth';
import { IdParams, day, money, pageQuery } from './common';

const router = Router();

// Settings: everyone can read (the POS needs the discount limit); only the owner can change.
router.get('/settings', async (_req, res) => ok(res, await getSettings(prisma)));

router.patch('/settings', ownerOnly, async (req, res) => {
  const me = currentUser(req);
  const patch = parseBody(SettingsSchema.partial().strict(), req.body);
  const before = await getSettings(prisma);
  const next = await updateSettings(prisma, patch);
  await audit(prisma, { userId: me.id, action: 'SETTINGS_UPDATED', entity: 'Setting', entityId: 'business', details: { before, after: next } });
  ok(res, next);
});

// Delivery areas
const AreaBody = z.object({
  name: z.string().trim().min(1).max(120),
  feeCentavos: money,
  isActive: z.boolean().optional(),
});

router.get('/delivery-areas', async (_req, res) => {
  ok(res, await prisma.deliveryArea.findMany({ orderBy: { name: 'asc' } }));
});

router.post('/delivery-areas', ownerOnly, async (req, res) => {
  const me = currentUser(req);
  const body = parseBody(AreaBody, req.body);
  const area = await withTx(async (tx) => {
    const a = await tx.deliveryArea.create({ data: body });
    await bumpCatalogVersion(tx);
    await audit(tx, { userId: me.id, action: 'DELIVERY_AREA_CREATED', entity: 'DeliveryArea', entityId: a.id, details: body });
    return a;
  });
  ok(res, area, 201);
});

router.patch('/delivery-areas/:id', ownerOnly, async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const body = parseBody(AreaBody.partial(), req.body);
  const area = await withTx(async (tx) => {
    const a = await tx.deliveryArea.update({ where: { id }, data: body });
    await bumpCatalogVersion(tx);
    await audit(tx, { userId: me.id, action: 'DELIVERY_AREA_UPDATED', entity: 'DeliveryArea', entityId: id, details: body });
    return a;
  });
  ok(res, area);
});

// Audit log
router.get('/audit-logs', ownerOnly, async (req, res) => {
  const q = parseQuery(
    z.object({
      entity: z.string().max(60).optional(),
      entityId: z.string().max(64).optional(),
      action: z.string().max(60).optional(),
      userId: z.string().max(64).optional(),
      from: day.optional(),
      to: day.optional(),
      ...pageQuery,
    }),
    req.query,
  );
  const { skip, take, page, pageSize } = paginate(q);
  const where: Prisma.AuditLogWhereInput = {
    entity: q.entity,
    entityId: q.entityId,
    action: q.action,
    userId: q.userId,
    createdAt: q.from && q.to ? businessRange(q.from, q.to) : undefined,
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, include: { user: { select: { name: true } } } }),
    prisma.auditLog.count({ where }),
  ]);
  ok(res, rows, 200, { page, pageSize, total });
});

export default router;
