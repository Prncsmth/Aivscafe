import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { AppError, forbidden } from './errors';
import type { Db } from './prisma';

/**
 * Login throttling, counted from the audit log in the database, so it survives restarts
 * (e.g. `tsx watch`, redeploys) and works across several API instances.
 *  - Per account: 5 wrong passwords within 15 min lock that username for 15 min.
 *  - Per IP: 20 wrong passwords within 15 min block that IP for 15 min (guessing many usernames).
 * A successful login starts the account counter again.
 */
export const LOGIN_POLICY = { maxPerAccount: 5, maxPerIp: 20, windowMs: 15 * 60_000 } as const;

const FAILURE_ACTIONS = ['LOGIN_FAILED'];

export async function assertLoginAllowed(db: Db, args: { username: string; userId: string | null; ip: string | undefined; now?: number }) {
  const now = args.now ?? Date.now();
  const windowStart = new Date(now - LOGIN_POLICY.windowMs);

  let since = windowStart;
  if (args.userId) {
    const lastSuccess = await db.auditLog.findFirst({
      where: { action: 'LOGIN', entityId: args.userId, createdAt: { gt: windowStart } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (lastSuccess) since = lastSuccess.createdAt;
  }

  const [accountFailures, ipFailures] = await Promise.all([
    db.auditLog.findMany({
      where: { action: { in: FAILURE_ACTIONS }, createdAt: { gt: since }, details: { path: ['username'], equals: args.username } },
      orderBy: { createdAt: 'desc' },
      take: LOGIN_POLICY.maxPerAccount,
      select: { createdAt: true },
    }),
    args.ip
      ? db.auditLog.count({ where: { action: { in: FAILURE_ACTIONS }, createdAt: { gt: windowStart }, details: { path: ['ip'], equals: args.ip } } })
      : Promise.resolve(0),
  ]);

  if (accountFailures.length >= LOGIN_POLICY.maxPerAccount) {
    const oldest = accountFailures[accountFailures.length - 1].createdAt.getTime();
    const minutes = Math.max(1, Math.ceil((oldest + LOGIN_POLICY.windowMs - now) / 60_000));
    throw new AppError(429, 'ACCOUNT_LOCKED', `Too many wrong passwords for this account. Try again in ${minutes} minute(s) or ask the owner to reset the password.`);
  }
  if (ipFailures >= LOGIN_POLICY.maxPerIp) {
    throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed logins from this device. Try again in 15 minutes.');
  }
}

/** True when the failures just recorded reach the account limit (used to audit the lock once). */
export async function isNowLocked(db: Db, username: string, now = Date.now()): Promise<boolean> {
  const count = await db.auditLog.count({
    where: { action: { in: FAILURE_ACTIONS }, createdAt: { gt: new Date(now - LOGIN_POLICY.windowMs) }, details: { path: ['username'], equals: username } },
  });
  return count === LOGIN_POLICY.maxPerAccount;
}

/**
 * CSRF guard for cookie-authenticated endpoints (/auth/refresh, /auth/logout).
 * Browsers always send Origin on cross-site POSTs; reject any origin that is not ours.
 */
export function requireTrustedOrigin(req: Request, _res: Response, next: NextFunction) {
  const origin = req.get('origin');
  if (origin && !env.corsOrigins.includes(origin)) return next(forbidden('Request origin not allowed'));
  next();
}
