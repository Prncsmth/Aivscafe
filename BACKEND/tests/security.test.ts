import { beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { api, auth, setupFixture, type Fixture } from './helpers';
import { prisma } from '../src/lib/prisma';

let f: Fixture;
beforeEach(async () => {
  f = await setupFixture();
});

const loginAs = (username: string, password: string) => api().post('/api/auth/login').send({ username, password });

describe('login protection', () => {
  it('locks the account after 5 wrong passwords, even for the right password afterwards', async () => {
    for (let i = 0; i < 5; i++) expect((await loginAs('cashier', 'wrong-password')).status).toBe(401);
    const locked = await loginAs('cashier', 'password123');
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(await prisma.auditLog.count({ where: { action: 'ACCOUNT_LOCKED' } })).toBe(1);
    // Other accounts are unaffected.
    expect((await loginAs('owner', 'password123')).status).toBe(200);
  });

  it('the lock survives a server restart (it is stored in the database)', async () => {
    for (let i = 0; i < 5; i++) await loginAs('cashier', 'wrong-password');
    // A fresh app instance (as after tsx watch / a redeploy) still sees the lock.
    const { createApp } = await import('../src/app');
    const request = (await import('supertest')).default;
    const res = await request(createApp()).post('/api/auth/login').send({ username: 'cashier', password: 'password123' });
    expect(res.status).toBe(429);
  });

  it('blocks an IP that guesses many usernames', async () => {
    for (let i = 0; i < 20; i++) await loginAs(`ghost${i}`, 'x');
    const res = await loginAs('owner', 'password123');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('a successful login clears earlier failures', async () => {
    for (let i = 0; i < 4; i++) await loginAs('cashier', 'nope');
    expect((await loginAs('cashier', 'password123')).status).toBe(200);
    for (let i = 0; i < 4; i++) await loginAs('cashier', 'nope');
    expect((await loginAs('cashier', 'password123')).status).toBe(200);
  });
});

describe('access tokens', () => {
  it('rejects unsigned (alg=none) tokens', async () => {
    const forged = jwt.sign({ role: 'OWNER' }, '', { algorithm: 'none', subject: f.ownerId, issuer: 'aivs-cafe-api', audience: 'aivs-cafe-app' });
    expect((await api().get('/api/users').set(auth(forged))).status).toBe(401);
  });

  it('rejects tokens with the wrong secret, issuer or audience', async () => {
    const secret = process.env.JWT_ACCESS_SECRET!;
    const wrongSecret = jwt.sign({ role: 'OWNER' }, 'another-secret-that-is-long-enough', { subject: f.ownerId, issuer: 'aivs-cafe-api', audience: 'aivs-cafe-app' });
    const wrongIssuer = jwt.sign({ role: 'OWNER' }, secret, { subject: f.ownerId, issuer: 'someone-else', audience: 'aivs-cafe-app' });
    const wrongAudience = jwt.sign({ role: 'OWNER' }, secret, { subject: f.ownerId, issuer: 'aivs-cafe-api', audience: 'other-app' });
    for (const t of [wrongSecret, wrongIssuer, wrongAudience]) expect((await api().get('/api/auth/me').set(auth(t))).status).toBe(401);
  });

  it('a cashier cannot promote themselves by editing the token role', async () => {
    // The role in the token is ignored for permissions: the database role is used.
    const secret = process.env.JWT_ACCESS_SECRET!;
    const tampered = jwt.sign({ role: 'OWNER' }, secret, { subject: f.cashierId, issuer: 'aivs-cafe-api', audience: 'aivs-cafe-app' });
    expect((await api().get('/api/users').set(auth(tampered))).status).toBe(403);
  });
});

describe('refresh tokens', () => {
  async function loginCookie() {
    const res = await loginAs('cashier', 'password123');
    return res.headers['set-cookie'] as unknown as string[];
  }

  it('revokes every session when an old refresh token is replayed (stolen token)', async () => {
    const stolen = await loginCookie();
    const other = await loginCookie(); // a second, legitimate device
    await api().post('/api/auth/refresh').set('Cookie', stolen).expect(200); // rotates `stolen`
    // Pretend the rotation happened a while ago, then the thief replays the old cookie.
    await prisma.session.updateMany({ where: { revokedAt: { not: null } }, data: { revokedAt: new Date(Date.now() - 5 * 60_000) } });
    const replay = await api().post('/api/auth/refresh').set('Cookie', stolen);
    expect(replay.status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'REFRESH_TOKEN_REUSE' } })).toBe(1);
    // All of the user's sessions are now dead, including the other device.
    expect((await api().post('/api/auth/refresh').set('Cookie', other)).status).toBe(401);
    expect(await prisma.session.count({ where: { userId: f.cashierId, revokedAt: null } })).toBe(0);
  });

  it('a quick double refresh (two tabs) is refused without logging everyone out', async () => {
    const cookie = await loginCookie();
    await api().post('/api/auth/refresh').set('Cookie', cookie).expect(200);
    const activeBefore = await prisma.session.count({ where: { userId: f.cashierId, revokedAt: null } });
    expect((await api().post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'REFRESH_TOKEN_REUSE' } })).toBe(0);
    // Nobody was signed out by the harmless race.
    expect(await prisma.session.count({ where: { userId: f.cashierId, revokedAt: null } })).toBe(activeBefore);
  });

  it('refuses refresh and logout requests from untrusted sites (CSRF)', async () => {
    const cookie = await loginCookie();
    expect((await api().post('/api/auth/refresh').set('Cookie', cookie).set('Origin', 'https://evil.example')).status).toBe(403);
    expect((await api().post('/api/auth/logout').set('Cookie', cookie).set('Origin', 'https://evil.example')).status).toBe(403);
    expect((await api().post('/api/auth/refresh').set('Cookie', cookie).set('Origin', 'http://localhost:3000')).status).toBe(200);
  });
});

describe('other safeguards', () => {
  it('API responses are never cached', async () => {
    const res = await api().get('/api/auth/me').set(auth(f.cashierToken));
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('a new user cannot use their username as password', async () => {
    const res = await api().post('/api/users').set(auth(f.ownerToken)).send({ name: 'Ana', username: 'ana12345', password: 'ana12345', role: 'CASHIER' });
    expect(res.status).toBe(400);
  });

  it('does not reveal whether a username exists', async () => {
    const a = await loginAs('nobody-here', 'x');
    const b = await loginAs('cashier', 'x');
    expect(a.status).toBe(b.status);
    expect(a.body.error.message).toBe(b.body.error.message);
  });
});
