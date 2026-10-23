import { beforeEach, describe, expect, it } from 'vitest';
import { api, auth, openShift, setupFixture, stockOf, uuid, type Fixture } from './helpers';
import { prisma } from '../src/lib/prisma';

let f: Fixture;
beforeEach(async () => {
  f = await setupFixture();
});

const order = (f: Fixture, extra: Record<string, unknown> = {}) => ({
  clientId: uuid(),
  type: 'WALK_IN',
  items: [{ variantId: f.smallId, quantity: 2, modifierIds: [f.pearlsModId] }],
  ...extra,
});

describe('POS orders', () => {
  it('requires an open shift', async () => {
    const res = await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_OPEN_SHIFT');
  });

  it('prices on the server, records cash change and deducts recipe inventory', async () => {
    await openShift(f.cashierToken);
    const res = await api()
      .post('/api/orders')
      .set(auth(f.cashierToken))
      .send(order(f, { payments: [{ method: 'CASH', amountCentavos: 11800, tenderedCentavos: 20000 }], expectedTotalCentavos: 11800 }));
    expect(res.status).toBe(201);
    const o = res.body.data.order;
    expect(o.reference).toMatch(/^AIV-\d{8}-0001$/);
    expect(o.subtotalCentavos).toBe(11800); // (49 + 10) * 2
    expect(o.paymentStatus).toBe('PAID');
    expect(o.payments[0].changeCentavos).toBe(8200);
    expect(await stockOf(f.cupId)).toBe(8);
    expect(await stockOf(f.powderId)).toBe(240);
    expect(await stockOf(f.pearlsId)).toBe(960);
  });

  it('is idempotent on clientId — a retried submit never duplicates the order or the deduction', async () => {
    await openShift(f.cashierToken);
    const body = order(f);
    const a = await api().post('/api/orders').set(auth(f.cashierToken)).send(body);
    const b = await api().post('/api/orders').set(auth(f.cashierToken)).send(body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.data.duplicate).toBe(true);
    expect(b.body.data.order.id).toBe(a.body.data.order.id);
    expect(await prisma.order.count()).toBe(1);
    expect(await stockOf(f.cupId)).toBe(8);
  });

  it('refuses the order when prices changed since the menu was loaded', async () => {
    await openShift(f.cashierToken);
    await api().patch(`/api/variants/${f.smallId}`).set(auth(f.ownerToken)).send({ priceCentavos: 5500 }).expect(200);
    const res = await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f, { expectedTotalCentavos: 11800 }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRICE_CHANGED');
    expect(res.body.error.details.serverTotalCentavos).toBe(13000);
  });

  it('limits cashier discounts and requires a reason', async () => {
    await openShift(f.cashierToken);
    const noReason = await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f, { discountCentavos: 1000 }));
    expect(noReason.status).toBe(400);
    const tooBig = await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f, { discountCentavos: 5000, discountReason: 'friend' }));
    expect(tooBig.status).toBe(403);
    const okDisc = await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f, { discountCentavos: 2360, discountReason: 'Senior citizen' }));
    expect(okDisc.status).toBe(201);
    expect(okDisc.body.data.order.totalCentavos).toBe(9440);
  });

  it('blocks orders that exceed stock; owner override is explicit and audited', async () => {
    await openShift(f.cashierToken);
    await openShift(f.ownerToken);
    const big = { variantId: f.largeId, quantity: 7 }; // needs 350 g powder, only 300 g
    const blocked = await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f, { items: [big] }));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await stockOf(f.powderId)).toBe(300);
    expect(await prisma.order.count()).toBe(0);

    const cashierOverride = await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f, { items: [big], allowNegativeStock: true }));
    expect(cashierOverride.status).toBe(403);

    const owner = await api().post('/api/orders').set(auth(f.ownerToken)).send(order(f, { items: [big], allowNegativeStock: true }));
    expect(owner.status).toBe(201);
    expect(await stockOf(f.powderId)).toBe(-50);
    expect(await prisma.auditLog.count({ where: { action: 'STOCK_NEGATIVE_ALLOWED' } })).toBe(1);
  });

  it('enforces the status workflow and payment before completion', async () => {
    await openShift(f.cashierToken);
    const o = (await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f))).body.data.order;
    const skip = await api().post(`/api/orders/${o.id}/status`).set(auth(f.cashierToken)).send({ to: 'READY' });
    expect(skip.status).toBe(409);
    expect(skip.body.error.code).toBe('INVALID_TRANSITION');
    await api().post(`/api/orders/${o.id}/status`).set(auth(f.cashierToken)).send({ to: 'PREPARING' }).expect(200);
    await api().post(`/api/orders/${o.id}/status`).set(auth(f.cashierToken)).send({ to: 'READY' }).expect(200);
    const unpaid = await api().post(`/api/orders/${o.id}/status`).set(auth(f.cashierToken)).send({ to: 'COMPLETED' });
    expect(unpaid.body.error.code).toBe('UNPAID');
    await api().post(`/api/orders/${o.id}/payments`).set(auth(f.cashierToken)).send({ method: 'GCASH', amountCentavos: 11800, reference: '1234' }).expect(201);
    const done = await api().post(`/api/orders/${o.id}/status`).set(auth(f.cashierToken)).send({ to: 'COMPLETED' });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('COMPLETED');
    expect(done.body.data.payments[0].verification).toBe('UNVERIFIED');
  });

  it('runs the delivery flow with area fee', async () => {
    await openShift(f.cashierToken);
    const res = await api()
      .post('/api/orders')
      .set(auth(f.cashierToken))
      .send(order(f, { type: 'DELIVERY', delivery: { customerName: 'Juan', contactNumber: '0917 123 4567', address: 'Bangbang, Cordova', areaId: f.areaId } }));
    expect(res.status).toBe(201);
    const o = res.body.data.order;
    expect(o.deliveryFeeCentavos).toBe(3000);
    expect(o.totalCentavos).toBe(14800);
    for (const to of ['PREPARING', 'READY', 'OUT_FOR_DELIVERY']) {
      await api().post(`/api/orders/${o.id}/status`).set(auth(f.cashierToken)).send({ to }).expect(200);
    }
    expect((await api().post(`/api/orders/${o.id}/status`).set(auth(f.cashierToken)).send({ to: 'COMPLETED' })).status).toBe(409);
    await api().post(`/api/orders/${o.id}/payments`).set(auth(f.cashierToken)).send({ method: 'CASH', amountCentavos: 14800, tenderedCentavos: 15000 }).expect(201);
    const delivered = await api().post(`/api/orders/${o.id}/status`).set(auth(f.cashierToken)).send({ to: 'DELIVERED' });
    expect(delivered.body.data.delivery.deliveredAt).toBeTruthy();
  });
});

describe('walk-in only shop (the default)', () => {
  beforeEach(async () => {
    await api().patch('/api/settings').set(auth(f.ownerToken)).send({ walkInOnly: true }).expect(200);
    await openShift(f.cashierToken);
  });

  it('every paid sale is completed at once and never enters the queue', async () => {
    const res = await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f, { completeNow: false, payments: [{ method: 'GCASH', amountCentavos: 11800 }] }));
    expect(res.status).toBe(201);
    expect(res.body.data.order.status).toBe('COMPLETED');
    expect((await api().get('/api/orders/queue').set(auth(f.cashierToken))).body.data).toHaveLength(0);
  });

  it('refuses unpaid sales and non-walk-in orders', async () => {
    const unpaid = await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f));
    expect(unpaid.status).toBe(400);
    expect(unpaid.body.error.message).toMatch(/full payment/);
    const delivery = await api()
      .post('/api/orders')
      .set(auth(f.cashierToken))
      .send(order(f, { type: 'DELIVERY', delivery: { customerName: 'Ana', contactNumber: '09171234567', address: 'Cordova', areaId: f.areaId }, payments: [{ method: 'CASH', amountCentavos: 14800 }] }));
    expect(delivery.status).toBe(400);
    expect(await prisma.order.count()).toBe(0);
    expect(await stockOf(f.cupId)).toBe(10);
  });

  it('is the default for a new shop', async () => {
    await prisma.setting.deleteMany({ where: { key: 'business' } });
    expect((await api().get('/api/settings').set(auth(f.cashierToken))).body.data.walkInOnly).toBe(true);
  });
});

describe('quick sale (walk-in at the counter)', () => {
  it('a paid walk-in is recorded as completed immediately by default', async () => {
    await openShift(f.cashierToken);
    const res = await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f, { payments: [{ method: 'CASH', amountCentavos: 11800 }] }));
    expect(res.status).toBe(201);
    expect(res.body.data.order.status).toBe('COMPLETED');
    const queue = await api().get('/api/orders/queue').set(auth(f.cashierToken));
    expect(queue.body.data).toHaveLength(0);
    // still counted in the shift and in stock
    const shift = (await api().get('/api/shifts/current').set(auth(f.cashierToken))).body.data;
    expect(shift.totalSalesCentavos).toBe(11800);
    expect(await stockOf(f.cupId)).toBe(8);
  });

  it('unpaid or delivery orders still go through the queue', async () => {
    await openShift(f.cashierToken);
    const unpaid = await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f));
    expect(unpaid.body.data.order.status).toBe('PENDING');
    const delivery = await api()
      .post('/api/orders')
      .set(auth(f.cashierToken))
      .send(order(f, { type: 'DELIVERY', completeNow: true, delivery: { customerName: 'Ana', contactNumber: '09171234567', address: 'Cordova', areaId: f.areaId }, payments: [{ method: 'CASH', amountCentavos: 14800 }] }));
    expect(delivery.body.data.order.status).toBe('PENDING');
  });

  it('can be turned off per order or rejected when unpaid', async () => {
    await openShift(f.cashierToken);
    const off = await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f, { completeNow: false, payments: [{ method: 'CASH', amountCentavos: 11800 }] }));
    expect(off.body.data.order.status).toBe('PENDING');
    const bad = await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f, { completeNow: true }));
    expect(bad.status).toBe(400);
  });
});

describe('cancellation, voids and inventory reversal', () => {
  it('restores inventory exactly once when a PENDING order is cancelled, and refunds cash', async () => {
    await openShift(f.cashierToken);
    const o = (await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f, { completeNow: false, payments: [{ method: 'CASH', amountCentavos: 11800 }] }))).body.data.order;
    expect(await stockOf(f.cupId)).toBe(8);
    const c = await api().post(`/api/orders/${o.id}/cancel`).set(auth(f.cashierToken)).send({ reason: 'Customer left' });
    expect(c.status).toBe(200);
    expect(c.body.data.status).toBe('CANCELLED');
    expect(c.body.data.paymentStatus).toBe('REFUNDED');
    expect(await stockOf(f.cupId)).toBe(10);
    const again = await api().post(`/api/orders/${o.id}/cancel`).set(auth(f.cashierToken)).send({ reason: 'again' });
    expect(again.status).toBe(409);
    expect(await stockOf(f.cupId)).toBe(10);
    expect(await prisma.inventoryMovement.count({ where: { orderId: o.id, type: 'SALE_REVERSAL' } })).toBe(3); // cup, powder, pearls
  });

  it('only the owner can cancel after preparation; ingredients are not restored by default', async () => {
    await openShift(f.cashierToken);
    await openShift(f.ownerToken);
    const o = (await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f))).body.data.order;
    await api().post(`/api/orders/${o.id}/status`).set(auth(f.cashierToken)).send({ to: 'PREPARING' }).expect(200);
    expect((await api().post(`/api/orders/${o.id}/cancel`).set(auth(f.cashierToken)).send({ reason: 'Changed mind' })).status).toBe(403);
    await api().post(`/api/orders/${o.id}/cancel`).set(auth(f.ownerToken)).send({ reason: 'Changed mind' }).expect(200);
    expect(await stockOf(f.cupId)).toBe(8);
  });

  it('voids completed orders (owner only) with optional restore', async () => {
    await openShift(f.cashierToken);
    await openShift(f.ownerToken);
    const o = (await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f, { completeNow: false, payments: [{ method: 'CASH', amountCentavos: 11800 }] }))).body.data.order;
    for (const to of ['PREPARING', 'READY', 'COMPLETED']) await api().post(`/api/orders/${o.id}/status`).set(auth(f.cashierToken)).send({ to }).expect(200);
    expect((await api().post(`/api/orders/${o.id}/void`).set(auth(f.cashierToken)).send({ reason: 'Wrong order' })).status).toBe(403);
    const v = await api().post(`/api/orders/${o.id}/void`).set(auth(f.ownerToken)).send({ reason: 'Wrong order', restoreInventory: true });
    expect(v.status).toBe(200);
    expect(v.body.data.status).toBe('VOIDED');
    expect(await stockOf(f.cupId)).toBe(10);
  });
});

describe('cash shifts', () => {
  it('computes expected cash excluding GCash and flags large variances for review', async () => {
    await openShift(f.cashierToken, 100000);
    await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f, { payments: [{ method: 'CASH', amountCentavos: 11800, tenderedCentavos: 12000 }] })).expect(201);
    await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f, { payments: [{ method: 'GCASH', amountCentavos: 11800 }] })).expect(201);
    await api()
      .post('/api/orders')
      .set(auth(f.cashierToken))
      .send(order(f, { payments: [{ method: 'GCASH', amountCentavos: 5000 }, { method: 'CASH', amountCentavos: 6800, tenderedCentavos: 7000 }] }))
      .expect(201);
    await api().post('/api/shifts/current/cash-movements').set(auth(f.cashierToken)).send({ type: 'CASH_OUT', amountCentavos: 20000, reason: 'Bought ice' }).expect(201);

    const cur = (await api().get('/api/shifts/current').set(auth(f.cashierToken))).body.data;
    expect(cur.expectedCashCentavos).toBe(100000 + 11800 + 6800 - 20000);
    expect(cur.expectedGcashCentavos).toBe(16800);

    const closed = await api()
      .post(`/api/shifts/${cur.shift.id}/close`)
      .set(auth(f.cashierToken))
      .send({ countedCashCentavos: 90000, reportedGcashCentavos: 16800 });
    expect(closed.status).toBe(200);
    expect(closed.body.data.shift.cashVarianceCentavos).toBe(90000 - 98600);
    expect(closed.body.data.shift.reviewStatus).toBe('PENDING_REVIEW');
    // shift is closed: a new order needs a new shift
    expect((await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f))).body.error.code).toBe('NO_OPEN_SHIFT');
  });

  it('allows only one open shift per user', async () => {
    await openShift(f.cashierToken);
    const res = await api().post('/api/shifts/open').set(auth(f.cashierToken)).send({ startingCashCentavos: 0 });
    expect(res.status).toBe(409);
  });
});

describe('inventory', () => {
  it('records purchases with unit conversion and weighted-average cost', async () => {
    const res = await api()
      .post('/api/purchases')
      .set(auth(f.ownerToken))
      .send({ items: [{ ingredientId: f.powderId, quantity: '1.5', unit: 'KG', totalCostCentavos: 90000, expiryDate: '2030-01-01' }] });
    expect(res.status).toBe(201);
    const ing = await prisma.ingredient.findUniqueOrThrow({ where: { id: f.powderId } });
    expect(ing.stockQty.toNumber()).toBe(1800);
    // (300 g × 50 + 1500 g × 60) / 1800 g = 58.3333 centavos/g
    expect(ing.avgUnitCost.toNumber()).toBeCloseTo(58.3333, 3);
  });

  it('rejects incompatible units', async () => {
    const res = await api().post('/api/purchases').set(auth(f.ownerToken)).send({ items: [{ ingredientId: f.powderId, quantity: 1, unit: 'L', totalCostCentavos: 100 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/incompatible/);
  });

  it('records waste without allowing negative stock', async () => {
    const tooMuch = await api().post(`/api/ingredients/${f.cupId}/waste`).set(auth(f.cashierToken)).send({ quantity: 11, reason: 'Crushed' });
    expect(tooMuch.status).toBe(409);
    await api().post(`/api/ingredients/${f.cupId}/waste`).set(auth(f.cashierToken)).send({ quantity: 2, reason: 'Crushed cups' }).expect(201);
    expect(await stockOf(f.cupId)).toBe(8);
  });

  it('stock count adjustments are owner-only', async () => {
    expect((await api().post(`/api/ingredients/${f.cupId}/adjust`).set(auth(f.cashierToken)).send({ countedQuantity: 5, reason: 'count' })).status).toBe(403);
    await api().post(`/api/ingredients/${f.cupId}/adjust`).set(auth(f.ownerToken)).send({ countedQuantity: 5, reason: 'Weekly count' }).expect(200);
    expect(await stockOf(f.cupId)).toBe(5);
  });
});

describe('reports', () => {
  it('separates revenue, COGS, gross profit, expenses and net operating profit', async () => {
    await openShift(f.cashierToken);
    await api().post('/api/orders').set(auth(f.cashierToken)).send(order(f, { payments: [{ method: 'CASH', amountCentavos: 11800 }] })).expect(201);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    await api().post('/api/expenses').set(auth(f.ownerToken)).send({ category: 'UTILITIES', description: 'Electricity', amountCentavos: 2000, incurredAt: new Date().toISOString() }).expect(201);
    const r = (await api().get(`/api/reports/sales?from=${today}&to=${today}`).set(auth(f.ownerToken))).body.data;
    // COGS: 2 cups × 300 + 60 g powder × 50 + 40 g pearls × 20 = 600 + 3000 + 800 = 4400
    expect(r.summary.netSalesCentavos).toBe(11800);
    expect(r.summary.cogsCentavos).toBe(4400);
    expect(r.summary.grossProfitCentavos).toBe(7400);
    expect(r.summary.operatingExpensesCentavos).toBe(2000);
    expect(r.summary.netOperatingProfitCentavos).toBe(5400);
    expect(r.summary.isEstimate).toBe(true);
    expect(r.byProduct[0]).toMatchObject({ name: 'Classic Milk Tea — Small', quantity: 2 });
  });
});
