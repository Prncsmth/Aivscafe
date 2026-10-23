import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { ok } from '../lib/http';
import { badRequest, unauthorized } from '../lib/errors';
import { audit } from '../lib/audit';
import { parseBody } from '../middleware/validate';
import { authenticate, currentUser, signAccessToken } from '../middleware/auth';
import { assertLoginAllowed, isNowLocked, requireTrustedOrigin } from '../lib/security';

export const REFRESH_COOKIE = 'sms_refresh';
const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many login attempts. Try again later.' } },
});

const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', 10);
const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE || env.COOKIE_SAMESITE === 'none',
    sameSite: env.COOKIE_SAMESITE,
    path: '/api/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  } as const;
}

async function issueSession(req: Request, res: Response, user: { id: string; role: 'OWNER' | 'CASHIER' }) {
  const token = crypto.randomBytes(48).toString('base64url');
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      userAgent: req.get('user-agent')?.slice(0, 250) ?? null,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    },
  });
  res.cookie(REFRESH_COOKIE, token, cookieOptions());
  return signAccessToken(user);
}

const publicUser = (u: { id: string; name: string; username: string; role: string }) => ({
  id: u.id,
  name: u.name,
  username: u.username,
  role: u.role,
});

const LoginSchema = z.object({
  username: z.string().trim().min(1).max(60),
  password: z.string().min(1).max(200),
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username: raw, password } = parseBody(LoginSchema, req.body);
  const username = raw.toLowerCase();
  const user = await prisma.user.findUnique({ where: { username } });
  await assertLoginAllowed(prisma, { username, userId: user?.id ?? null, ip: req.ip });
  // Compare even when the user is missing to keep timing similar.
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid || !user.isActive) {
    await audit(prisma, { action: 'LOGIN_FAILED', entity: 'User', entityId: user?.id ?? null, details: { username, ip: req.ip ?? null } });
    if (await isNowLocked(prisma, username)) {
      await audit(prisma, { action: 'ACCOUNT_LOCKED', entity: 'User', entityId: user?.id ?? null, details: { username, ip: req.ip ?? null } });
    }
    throw unauthorized('Incorrect username or password');
  }
  // Housekeeping: drop this user's expired sessions.
  await prisma.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
  const accessToken = await issueSession(req, res, user);
  await audit(prisma, { userId: user.id, action: 'LOGIN', entity: 'User', entityId: user.id });
  ok(res, { accessToken, user: publicUser(user) });
});

/** Seconds after rotation during which reusing the old token is treated as a harmless race (two tabs). */
const REUSE_GRACE_MS = 60_000;

/**
 * Rotates the refresh token: the old one is revoked, a new one is issued.
 * Reuse detection: presenting a token that was rotated away more than a minute ago means it was
 * probably copied/stolen, so every session of that user is revoked and the event is audited.
 */
router.post('/refresh', requireTrustedOrigin, async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw unauthorized('No session');
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (session?.revokedAt && Date.now() - session.revokedAt.getTime() > REUSE_GRACE_MS) {
    await prisma.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(prisma, { userId: session.userId, action: 'REFRESH_TOKEN_REUSE', entity: 'User', entityId: session.userId, details: { ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 120) } });
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    throw unauthorized('Session ended for security reasons. Please log in again.');
  }
  if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    throw unauthorized('Session expired. Please log in again.');
  }
  const revoked = await prisma.session.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (revoked.count === 0) throw unauthorized('Session already used');
  const accessToken = await issueSession(req, res, session.user);
  ok(res, { accessToken, user: publicUser(session.user) });
});

router.post('/logout', requireTrustedOrigin, async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) await prisma.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  ok(res, { loggedOut: true });
});

router.get('/me', authenticate, async (req, res) => {
  ok(res, { user: currentUser(req) });
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Use at least 8 characters').max(200),
}).refine((b) => b.newPassword !== b.currentPassword, { message: 'Choose a different password', path: ['newPassword'] });

router.post('/change-password', authenticate, async (req, res) => {
  const me = currentUser(req);
  const body = parseBody(ChangePasswordSchema, req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
  if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) throw badRequest('Current password is incorrect');
  await prisma.$transaction([
    prisma.user.update({ where: { id: me.id }, data: { passwordHash: await bcrypt.hash(body.newPassword, 12) } }),
    prisma.session.updateMany({ where: { userId: me.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit(prisma, { userId: me.id, action: 'PASSWORD_CHANGED', entity: 'User', entityId: me.id });
  const accessToken = await issueSession(req, res, user);
  ok(res, { accessToken });
});

export default router;
