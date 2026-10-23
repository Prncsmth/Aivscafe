import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { forbidden, unauthorized } from '../lib/errors';

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface AccessPayload {
  sub: string;
  role: Role;
}

const JWT_ISSUER = 'aivs-cafe-api';
const JWT_AUDIENCE = 'aivs-cafe-app';

export function signAccessToken(user: { id: string; role: Role }): string {
  return jwt.sign({ role: user.role } satisfies Omit<AccessPayload, 'sub'>, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: user.id,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_TTL_MINUTES * 60,
  });
}

/** Verifies the Bearer access token and re-checks that the account is still active. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  let payload: AccessPayload;
  try {
    // Pin the algorithm (blocks alg=none / algorithm-confusion tokens) and check issuer + audience.
    payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE }) as AccessPayload;
  } catch {
    return next(unauthorized('Session expired or invalid'));
  }
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, name: true, username: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) return next(unauthorized('Account is disabled'));
  req.user = { id: user.id, name: user.name, username: user.username, role: user.role };
  next();
}

/** Role guard — enforced on the server regardless of what the UI shows. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export const ownerOnly = requireRole('OWNER');

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
