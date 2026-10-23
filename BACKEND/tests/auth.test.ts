import { beforeAll, describe, expect, it } from 'vitest';
import { api, auth, setupFixture, type Fixture } from './helpers';
import { prisma } from '../src/lib/prisma';

let f: Fixture;
beforeAll(async () => {
  f = await setupFixture();
});

describe('authentication', () => {
  it('rejects wrong passwords with a generic message', async () => {
    const res = await api().post('/api/auth/login').send({ username: 'owner', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('returns the current user and never the password hash', async () => {
    const res = await api().get('/api/auth/me').set(auth(f.cashierToken));
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ username: 'cashier', role: 'CASHIER' });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('requires a token', async () => {
    expect((await api().get('/api/orders')).status).toBe(401);
    expect((await api().get('/api/orders').set({ Authorization: 'Bearer garbage' })).status).toBe(401);
  });

  it('rotates refresh tokens and rejects reuse', async () => {
    const login = await api().post('/api/auth/login').send({ username: 'cashier', password: 'password123' });
    const cookie = login.headers['set-cookie'] as unknown as string[];
    expect(cookie.join(';')).toMatch(/HttpOnly/i);
    const first = await api().post('/api/auth/refresh').set('Cookie', cookie);
    expect(first.status).toBe(200);
    expect(first.body.data.accessToken).toBeTruthy();
    const reuse = await api().post('/api/auth/refresh').set('Cookie', cookie);
    expect(reuse.status).toBe(401);
  });

  it('blocks deactivated users immediately', async () => {
    const u = await prisma.user.create({ data: { name: 'temp', username: 'temp', role: 'CASHIER', passwordHash: (await prisma.user.findFirstOrThrow({ where: { username: 'cashier' } })).passwordHash } });
    const token = (await api().post('/api/auth/login').send({ username: 'temp', password: 'password123' })).body.data.accessToken;
    await api().patch(`/api/users/${u.id}`).set(auth(f.ownerToken)).send({ isActive: false }).expect(200);
    expect((await api().get('/api/auth/me').set(auth(token))).status).toBe(401);
  });
});

describe('role-based access is enforced by the backend', () => {
  it.each([
    ['get', '/api/users'],
    ['get', '/api/reports/sales?from=2025-01-01&to=2025-01-31'],
    ['get', '/api/dashboard/owner'],
    ['get', '/api/audit-logs'],
    ['get', '/api/expenses'],
    ['get', '/api/sync/conflicts'],
    ['get', '/api/inventory/valuation'],
    ['get', '/api/catalog/admin'],
  ])('cashier cannot %s %s', async (method, url) => {
    const res = await (api() as unknown as Record<string, (u: string) => ReturnType<ReturnType<typeof api>['get']>>)[method](url).set(auth(f.cashierToken));
    expect(res.status).toBe(403);
  });

  it('cashier cannot change prices', async () => {
    const res = await api().patch(`/api/variants/${f.smallId}`).set(auth(f.cashierToken)).send({ priceCentavos: 100 });
    expect(res.status).toBe(403);
    const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: f.smallId } });
    expect(v.priceCentavos).toBe(4900);
  });

  it('cashier cannot create users or change settings', async () => {
    expect((await api().post('/api/users').set(auth(f.cashierToken)).send({ name: 'x', username: 'xyz', password: 'password123' })).status).toBe(403);
    expect((await api().patch('/api/settings').set(auth(f.cashierToken)).send({ maxCashierDiscountPercent: 100 })).status).toBe(403);
  });

  it('cashier sees ingredient stock but not costs', async () => {
    const res = await api().get('/api/ingredients').set(auth(f.cashierToken));
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toHaveProperty('stockQty');
    expect(res.body.data[0]).not.toHaveProperty('avgUnitCost');
  });

  it('owner price changes are audited and bump the catalog version', async () => {
    const before = (await api().get('/api/catalog').set(auth(f.cashierToken))).body.data.version;
    await api().patch(`/api/variants/${f.largeId}`).set(auth(f.ownerToken)).send({ priceCentavos: 7400 }).expect(200);
    const after = (await api().get('/api/catalog').set(auth(f.cashierToken))).body.data.version;
    expect(after).toBe(before + 1);
    const log = await prisma.auditLog.findFirst({ where: { action: 'PRICE_CHANGED', entityId: f.largeId } });
    expect(log).toBeTruthy();
  });

  it('validates request bodies with field-level errors', async () => {
    const res = await api().post('/api/orders').set(auth(f.cashierToken)).send({ clientId: 'not-a-uuid', type: 'WALK_IN', items: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['clientId', 'items']));
  });
});
