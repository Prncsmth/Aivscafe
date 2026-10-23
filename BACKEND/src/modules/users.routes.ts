import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ok } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { parseBody, parseParams } from '../middleware/validate';
import { currentUser, ownerOnly } from '../middleware/auth';
import { IdParams } from './common';

const router = Router();
router.use(ownerOnly);

const select = { id: true, name: true, username: true, role: true, isActive: true, createdAt: true } as const;

router.get('/', async (_req, res) => {
  ok(res, await prisma.user.findMany({ select, orderBy: [{ role: 'asc' }, { name: 'asc' }] }));
});

const CreateUser = z.object({
  name: z.string().trim().min(1).max(120),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore'),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
  role: z.enum(['OWNER', 'CASHIER']).default('CASHIER'),
}).refine((b) => b.password.toLowerCase() !== b.username, { message: 'Password must not be the same as the username', path: ['password'] });

router.post('/', async (req, res) => {
  const me = currentUser(req);
  const body = parseBody(CreateUser, req.body);
  const user = await prisma.user.create({
    data: { name: body.name, username: body.username, role: body.role, passwordHash: await bcrypt.hash(body.password, 12) },
    select,
  });
  await audit(prisma, { userId: me.id, action: 'USER_CREATED', entity: 'User', entityId: user.id, details: { username: user.username, role: user.role } });
  ok(res, user, 201);
});

const UpdateUser = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(['OWNER', 'CASHIER']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
});

router.patch('/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parseParams(IdParams, req.params);
  const body = parseBody(UpdateUser, req.body);
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw notFound('User');
  if (id === me.id && (body.isActive === false || body.role === 'CASHIER')) {
    throw badRequest('You cannot deactivate or demote your own account');
  }
  if (target.role === 'OWNER' && (body.isActive === false || body.role === 'CASHIER')) {
    const owners = await prisma.user.count({ where: { role: 'OWNER', isActive: true } });
    if (owners <= 1) throw badRequest('At least one active owner is required');
  }
  const user = await prisma.user.update({
    where: { id },
    data: {
      name: body.name,
      role: body.role,
      isActive: body.isActive,
      passwordHash: body.password ? await bcrypt.hash(body.password, 12) : undefined,
    },
    select,
  });
  if (body.isActive === false || body.password) {
    await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  await audit(prisma, {
    userId: me.id,
    action: 'USER_UPDATED',
    entity: 'User',
    entityId: id,
    details: { ...body, password: body.password ? '[reset]' : undefined },
  });
  ok(res, user);
});

export default router;
