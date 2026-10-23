import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ok, paginate } from '../lib/http';
import { conflict, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { parseBody, parseParams, parseQuery } from '../middleware/validate';
import { currentUser, ownerOnly } from '../middleware/auth';
import { SyncRequestSchema, syncOrders } from '../services/sync.service';
import { IdParams, pageQuery } from './common';

const router = Router();

/**
 * POST /api/sync/orders — idempotent batch upload of offline orders.
 * Always 200 with a per-order result; the client marks each order synced or failed individually.
 */
router.post('/sync/orders', async (req, res) => {
  const me = currentUser(req);
  const { deviceId, orders } = parseBody(SyncRequestSchema, req.body);
  const results = await syncOrders(me, deviceId, orders);
  ok(res, { results, serverTime: new Date().toISOString() });
});

router.get('/sync/conflicts', ownerOnly, async (req, res) => {
  const q = parseQuery(z.object({ status: z.enum(['OPEN', 'RESOLVED']).optional(), ...pageQuery }), req.query);
  const { skip, take, page, pageSize } = paginate(q);
  const where = { status: q.status };
  const [rows, total] = await Promise.all([
    prisma.syncConflict.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        order: { select: { id: true, reference: true, tempReference: true, totalCentavos: true, createdAt: true, cashier: { select: { name: true } } } },
        resolvedBy: { select: { name: true } },
      },
    }),
    prisma.syncConflict.count({ where }),
  ]);
  ok(res, rows, 200, { page, pageSize, total });
});

router.post('/sync/conflicts/:id/resolve', ownerOnly, async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const { resolution } = parseBody(z.object({ resolution: z.string().trim().min(3).max(500) }), req.body);
  const c = await prisma.syncConflict.findUnique({ where: { id } });
  if (!c) throw notFound('Conflict');
  if (c.status === 'RESOLVED') throw conflict('ALREADY_RESOLVED', 'This conflict is already resolved');
  const updated = await prisma.syncConflict.update({
    where: { id },
    data: { status: 'RESOLVED', resolvedById: me.id, resolvedAt: new Date(), resolution },
  });
  await audit(prisma, { userId: me.id, action: 'CONFLICT_RESOLVED', entity: 'SyncConflict', entityId: id, details: { type: c.type, orderId: c.orderId, resolution } });
  ok(res, updated);
});

export default router;
