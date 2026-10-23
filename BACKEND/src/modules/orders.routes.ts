import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, withTx } from '../lib/prisma';
import { ok, paginate } from '../lib/http';
import { notFound } from '../lib/errors';
import { businessRange } from '../lib/time';
import { parseBody, parseParams, parseQuery } from '../middleware/validate';
import { currentUser } from '../middleware/auth';
import { addPayment, advanceStatus, cancelOrVoid, createOrder, orderInclude, verifyPayment } from '../services/order.service';
import { IdParams, day, money, optionalText, pageQuery, positiveMoney } from './common';

const router = Router();

const PaymentBody = z.object({
  method: z.enum(['CASH', 'GCASH']),
  amountCentavos: positiveMoney,
  tenderedCentavos: positiveMoney.nullable().optional(),
  reference: optionalText(80),
  /** GCash only: the recorder confirmed the transfer in the GCash app. */
  verified: z.boolean().optional(),
});

const CreateOrderBody = z.object({
  clientId: z.string().uuid(),
  type: z.enum(['WALK_IN', 'DELIVERY', 'MESSENGER']),
  customerName: optionalText(120),
  notes: optionalText(500),
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().min(1).max(999),
        modifierIds: z.array(z.string().min(1)).max(20).optional(),
        notes: optionalText(300),
      }),
    )
    .min(1, 'Add at least one item')
    .max(100),
  discountCentavos: money.optional(),
  discountReason: optionalText(200),
  delivery: z
    .object({
      customerName: z.string().trim().min(1).max(120),
      contactNumber: z.string().trim().min(7).max(40).regex(/^[0-9+\-\s()]+$/, 'Invalid contact number'),
      address: z.string().trim().min(3).max(500),
      areaId: z.string().min(1),
      instructions: optionalText(500),
      deliveryFeeCentavos: money.optional(),
    })
    .nullable()
    .optional(),
  payments: z.array(PaymentBody).max(5).optional(),
  expectedTotalCentavos: money.optional(),
  allowNegativeStock: z.boolean().optional(),
  /** Quick sale: record as Completed immediately (needs full payment; not for deliveries). */
  completeNow: z.boolean().optional(),
});

const ListQuery = z.object({
  status: z.enum(['PENDING', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'VOIDED']).optional(),
  type: z.enum(['WALK_IN', 'DELIVERY', 'MESSENGER']).optional(),
  paymentStatus: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']).optional(),
  source: z.enum(['ONLINE', 'OFFLINE_SYNC']).optional(),
  from: day.optional(),
  to: day.optional(),
  q: z.string().trim().max(60).optional(),
  ...pageQuery,
});

/** Cashiers may look back this many days; owners have no limit. */
const CASHIER_HISTORY_DAYS = 3;

router.get('/orders', async (req, res) => {
  const me = currentUser(req);
  const q = parseQuery(ListQuery, req.query);
  const { skip, take, page, pageSize } = paginate(q);
  const createdAt: Prisma.DateTimeFilter = {};
  if (q.from && q.to) Object.assign(createdAt, businessRange(q.from, q.to));
  if (me.role === 'CASHIER') {
    const floor = new Date(Date.now() - CASHIER_HISTORY_DAYS * 86_400_000);
    if (!createdAt.gte || (createdAt.gte as Date) < floor) createdAt.gte = floor;
  }
  const where: Prisma.OrderWhereInput = {
    status: q.status,
    type: q.type,
    paymentStatus: q.paymentStatus,
    source: q.source,
    createdAt: Object.keys(createdAt).length ? createdAt : undefined,
    ...(q.q
      ? {
          OR: [
            { reference: { contains: q.q, mode: 'insensitive' } },
            { tempReference: { contains: q.q, mode: 'insensitive' } },
            { customerName: { contains: q.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, include: orderInclude }),
    prisma.order.count({ where }),
  ]);
  ok(res, rows, 200, { page, pageSize, total });
});

/** Active order queue for the counter. */
router.get('/orders/queue', async (_req, res) => {
  const rows = await prisma.order.findMany({
    where: { status: { in: ['PENDING', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] } },
    orderBy: { createdAt: 'asc' },
    include: orderInclude,
    take: 200,
  });
  ok(res, rows);
});

router.get('/orders/:id', async (req, res) => {
  const { id } = parseParams(IdParams, req.params);
  const order = await prisma.order.findFirst({
    where: { OR: [{ id }, { reference: id }, { clientId: id }] },
    include: { ...orderInclude, statusLog: { orderBy: { createdAt: 'asc' } }, cancelledBy: { select: { name: true } } },
  });
  if (!order) throw notFound('Order');
  ok(res, order);
});

router.post('/orders', async (req, res) => {
  const me = currentUser(req);
  const body = parseBody(CreateOrderBody, req.body);
  const result = await withTx((tx) => createOrder(tx, me, body));
  ok(res, result, result.duplicate ? 200 : 201);
});

router.post('/orders/:id/status', async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const { to } = parseBody(
    z.object({ to: z.enum(['PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED']) }),
    req.body,
  );
  ok(res, await withTx((tx) => advanceStatus(tx, me, id, to)));
});

const CancelBody = z.object({
  reason: z.string().trim().min(3, 'Give a reason').max(300),
  restoreInventory: z.boolean().optional(),
  refund: z.boolean().optional(),
});

router.post('/orders/:id/cancel', async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const body = parseBody(CancelBody, req.body);
  ok(res, await withTx((tx) => cancelOrVoid(tx, me, id, { mode: 'CANCEL', ...body })));
});

router.post('/orders/:id/void', async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const body = parseBody(CancelBody, req.body);
  ok(res, await withTx((tx) => cancelOrVoid(tx, me, id, { mode: 'VOID', ...body })));
});

router.post('/orders/:id/payments', async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const body = parseBody(PaymentBody, req.body);
  ok(res, await withTx((tx) => addPayment(tx, me, id, body)), 201);
});

router.get('/payments/unverified', async (_req, res) => {
  ok(
    res,
    await prisma.payment.findMany({
      where: { method: 'GCASH', kind: 'PAYMENT', verification: 'UNVERIFIED' },
      orderBy: { createdAt: 'asc' },
      include: { order: { select: { id: true, reference: true, tempReference: true, customerName: true } }, user: { select: { name: true } } },
    }),
  );
});

router.post('/payments/:id/verify', async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const { reference } = parseBody(z.object({ reference: optionalText(80) }), req.body ?? {});
  ok(res, await withTx((tx) => verifyPayment(tx, me, id, reference)));
});

export default router;
