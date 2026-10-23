import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ok, paginate } from '../lib/http';
import { audit } from '../lib/audit';
import { businessRange } from '../lib/time';
import { parseBody, parseParams, parseQuery } from '../middleware/validate';
import { currentUser, ownerOnly } from '../middleware/auth';
import { IdParams, day, optionalText, pageQuery, positiveMoney } from './common';

const router = Router();
router.use('/expenses', ownerOnly);

const category = z.enum(['INGREDIENTS', 'PACKAGING', 'TRANSPORTATION', 'UTILITIES', 'RENT', 'SALARIES', 'OTHER']);
const ExpenseBody = z.object({
  category,
  description: z.string().trim().min(1).max(200),
  amountCentavos: positiveMoney,
  incurredAt: z.coerce.date(),
  notes: optionalText(500),
});

router.get('/expenses', async (req, res) => {
  const q = parseQuery(z.object({ from: day.optional(), to: day.optional(), category: category.optional(), ...pageQuery }), req.query);
  const { skip, take, page, pageSize } = paginate(q);
  const where: Prisma.ExpenseWhereInput = {
    category: q.category,
    incurredAt: q.from && q.to ? businessRange(q.from, q.to) : undefined,
  };
  const [rows, total, sum] = await Promise.all([
    prisma.expense.findMany({ where, orderBy: { incurredAt: 'desc' }, skip, take, include: { user: { select: { name: true } } } }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amountCentavos: true } }),
  ]);
  ok(res, rows, 200, { page, pageSize, total, totalCentavos: sum._sum.amountCentavos ?? 0 });
});

router.post('/expenses', async (req, res) => {
  const me = currentUser(req);
  const body = parseBody(ExpenseBody, req.body);
  const e = await prisma.expense.create({ data: { ...body, userId: me.id } });
  await audit(prisma, { userId: me.id, action: 'EXPENSE_CREATED', entity: 'Expense', entityId: e.id, details: body });
  ok(res, e, 201);
});

router.patch('/expenses/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const body = parseBody(ExpenseBody.partial(), req.body);
  const before = await prisma.expense.findUniqueOrThrow({ where: { id } });
  const e = await prisma.expense.update({ where: { id }, data: body });
  await audit(prisma, { userId: me.id, action: 'EXPENSE_UPDATED', entity: 'Expense', entityId: id, details: { before, after: body } });
  ok(res, e);
});

router.delete('/expenses/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const before = await prisma.expense.findUniqueOrThrow({ where: { id } });
  await prisma.expense.delete({ where: { id } });
  await audit(prisma, { userId: me.id, action: 'EXPENSE_DELETED', entity: 'Expense', entityId: id, details: before });
  ok(res, { deleted: true });
});

export default router;
