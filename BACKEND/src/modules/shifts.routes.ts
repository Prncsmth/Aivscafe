import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, withTx } from '../lib/prisma';
import { ok, paginate } from '../lib/http';
import { forbidden } from '../lib/errors';
import { parseBody, parseParams, parseQuery } from '../middleware/validate';
import { currentUser, ownerOnly } from '../middleware/auth';
import { addCashMovement, closeShift, openShift, reviewShift, shiftSummary } from '../services/shift.service';
import { IdParams, money, optionalText, pageQuery, positiveMoney } from './common';

const router = Router();

router.get('/shifts/current', async (req, res) => {
  const me = currentUser(req);
  const shift = await prisma.cashShift.findUnique({ where: { openKey: me.id } });
  ok(res, shift ? await shiftSummary(prisma, shift.id) : null);
});

router.post('/shifts/open', async (req, res) => {
  const me = currentUser(req);
  const body = parseBody(z.object({ startingCashCentavos: money, notes: optionalText(300) }), req.body);
  const shift = await withTx((tx) => openShift(tx, me, body.startingCashCentavos, body.notes));
  ok(res, await shiftSummary(prisma, shift.id), 201);
});

router.post('/shifts/current/cash-movements', async (req, res) => {
  const me = currentUser(req);
  const body = parseBody(
    z.object({ type: z.enum(['CASH_IN', 'CASH_OUT']), amountCentavos: positiveMoney, reason: z.string().trim().min(3).max(200) }),
    req.body,
  );
  ok(res, await withTx((tx) => addCashMovement(tx, me, body)), 201);
});

const CloseBody = z.object({
  countedCashCentavos: money,
  reportedGcashCentavos: money.nullable().optional(),
  notes: optionalText(500),
});

router.post('/shifts/:id/close', async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const body = parseBody(CloseBody, req.body);
  ok(res, await withTx((tx) => closeShift(tx, me, id, body)));
});

router.get('/shifts/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const summary = await shiftSummary(prisma, id);
  if (me.role !== 'OWNER' && summary.shift.userId !== me.id) throw forbidden();
  const movements = await prisma.cashMovement.findMany({ where: { shiftId: id }, orderBy: { createdAt: 'asc' } });
  ok(res, { ...summary, cashMovements: movements });
});

router.get('/shifts', ownerOnly, async (req, res) => {
  const q = parseQuery(
    z.object({ status: z.enum(['OPEN', 'CLOSED']).optional(), reviewStatus: z.enum(['NOT_REQUIRED', 'PENDING_REVIEW', 'REVIEWED']).optional(), ...pageQuery }),
    req.query,
  );
  const { skip, take, page, pageSize } = paginate(q);
  const where: Prisma.CashShiftWhereInput = { status: q.status, reviewStatus: q.reviewStatus };
  const [rows, total] = await Promise.all([
    prisma.cashShift.findMany({ where, orderBy: { openedAt: 'desc' }, skip, take, include: { user: { select: { name: true } }, reviewedBy: { select: { name: true } } } }),
    prisma.cashShift.count({ where }),
  ]);
  ok(res, rows, 200, { page, pageSize, total });
});

router.post('/shifts/:id/review', ownerOnly, async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const { note } = parseBody(z.object({ note: z.string().trim().min(3).max(500) }), req.body);
  ok(res, await withTx((tx) => reviewShift(tx, me, id, note)));
});

export default router;
