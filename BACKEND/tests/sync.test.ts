import { beforeEach, describe, expect, it } from 'vitest';
import { api, auth, openShift, setupFixture, stockOf, uuid, type Fixture } from './helpers';
import { prisma } from '../src/lib/prisma';

let f: Fixture;
let shiftId: string;
beforeEach(async () => {
  f = await setupFixture();
  shiftId = await openShift(f.cashierToken);
});

/** An order exactly as the offline POS stores it in IndexedDB. */
function offlineOrder(over: Record<string, unknown> = {}) {
  return {
    clientId: uuid(),
    tempReference: 'OFF-A1B2-0001',
    clientCreatedAt: new Date().toISOString(),
    catalogVersion: 1,
    shiftId,
    type: 'WALK_IN',
    status: 'COMPLETED',
    items: [
      {
        variantId: f.smallId,
        productName: 'Classic Milk Tea',
        variantName: 'Small',
        unitPriceCentavos: 4900,
        quantity: 2,
        modifiers: [{ modifierId: f.pearlsModId, name: 'Extra pearls', priceCentavos: 1000 }],
      },
    ],
    discountCentavos: 0,
    deliveryFeeCentavos: 0,
    payments: [{ method: 'CASH', amountCentavos: 11800, tenderedCentavos: 12000 }],
    subtotalCentavos: 11800,
    totalCentavos: 11800,
    ...over,
  };
}

const sync = (orders: unknown[], token = f.cashierToken) =>
  api().post('/api/sync/orders').set(auth(token)).send({ deviceId: 'tablet-1', orders });

describe('offline order synchronisation', () => {
  it('syncs an offline order, returns the confirmed reference and deducts inventory', async () => {
    const o = offlineOrder();
    const res = await sync([o]);
    expect(res.status).toBe(200);
    const [r] = res.body.data.results;
    expect(r).toMatchObject({ clientId: o.clientId, status: 'SYNCED', duplicate: false, conflicts: [] });
    expect(r.reference).toMatch(/^AIV-/);
    const saved = await prisma.order.findUniqueOrThrow({ where: { clientId: o.clientId }, include: { payments: true } });
    expect(saved.source).toBe('OFFLINE_SYNC');
    expect(saved.tempReference).toBe('OFF-A1B2-0001');
    expect(saved.status).toBe('COMPLETED');
    expect(saved.payments[0]).toMatchObject({ recordedOffline: true, changeCentavos: 200 });
    expect(await stockOf(f.cupId)).toBe(8);
  });

  it('duplicate sync requests return the same order and never deduct inventory twice', async () => {
    const o = offlineOrder();
    const first = (await sync([o])).body.data.results[0];
    const second = (await sync([o])).body.data.results[0];
    expect(second).toMatchObject({ status: 'SYNCED', duplicate: true, orderId: first.orderId, reference: first.reference });
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.inventoryMovement.count({ where: { type: 'SALE' } })).toBe(3);
    expect(await stockOf(f.cupId)).toBe(8);
    expect(await prisma.payment.count()).toBe(1);
  });

  it('is safe when the server processed the order but the response was lost (concurrent retries)', async () => {
    const o = offlineOrder();
    // The client gave up waiting and retried while the first request was still running.
    const [a, b, c] = await Promise.all([sync([o]), sync([o]), sync([o])]);
    const results = [a, b, c].map((r) => r.body.data.results[0]);
    expect(results.every((r) => r.status === 'SYNCED')).toBe(true);
    expect(new Set(results.map((r) => r.orderId)).size).toBe(1);
    expect(results.filter((r) => !r.duplicate).length).toBe(1);
    expect(await prisma.order.count()).toBe(1);
    expect(await stockOf(f.cupId)).toBe(8);
    expect(await stockOf(f.powderId)).toBe(240);
  });

  it('handles partial failures without losing the successful orders', async () => {
    const good1 = offlineOrder();
    const bad = offlineOrder({ totalCentavos: 99 }); // corrupt totals
    const good2 = offlineOrder({ tempReference: 'OFF-A1B2-0002' });
    const garbage = { clientId: 'x' };
    const res = await sync([good1, bad, good2, garbage]);
    const results = res.body.data.results;
    expect(results.map((r: { status: string }) => r.status)).toEqual(['SYNCED', 'FAILED', 'SYNCED', 'FAILED']);
    expect(results[1]).toMatchObject({ retryable: false, error: { code: 'TOTAL_MISMATCH' } });
    expect(results[3]).toMatchObject({ retryable: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await prisma.order.count()).toBe(2);
    expect(await stockOf(f.cupId)).toBe(6);
  });

  it('keeps the price the customer paid offline but flags a PRICE_MISMATCH conflict', async () => {
    await api().patch(`/api/variants/${f.smallId}`).set(auth(f.ownerToken)).send({ priceCentavos: 5500 }).expect(200);
    const o = offlineOrder();
    const [r] = (await sync([o])).body.data.results;
    expect(r.status).toBe('SYNCED');
    expect(r.conflicts).toContain('PRICE_MISMATCH');
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: r.orderId }, include: { items: true, conflicts: true } });
    expect(saved.totalCentavos).toBe(11800);
    expect(saved.items[0].unitPriceCentavos).toBe(4900);
    // The server price is not overwritten either.
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: f.smallId } })).priceCentavos).toBe(5500);
    expect(saved.conflicts[0]).toMatchObject({ type: 'PRICE_MISMATCH', status: 'OPEN' });
  });

  it('accepts an offline sale that exceeds stock, records negative stock and flags it', async () => {
    const o = offlineOrder({
      items: [{ variantId: f.largeId, productName: 'Classic Milk Tea', variantName: 'Large', unitPriceCentavos: 6900, quantity: 7, modifiers: [] }],
      payments: [{ method: 'CASH', amountCentavos: 48300 }],
      subtotalCentavos: 48300,
      totalCentavos: 48300,
    });
    const [r] = (await sync([o])).body.data.results;
    expect(r.status).toBe('SYNCED');
    expect(r.conflicts).toContain('INSUFFICIENT_STOCK');
    expect(await stockOf(f.powderId)).toBe(-50);
  });

  it('never marks offline GCash as verified', async () => {
    const o = offlineOrder({ payments: [{ method: 'GCASH', amountCentavos: 11800, reference: '99887766' }] });
    const [r] = (await sync([o])).body.data.results;
    const p = await prisma.payment.findFirstOrThrow({ where: { orderId: r.orderId } });
    expect(p).toMatchObject({ method: 'GCASH', verification: 'UNVERIFIED', recordedOffline: true });
    const list = await api().get('/api/payments/unverified').set(auth(f.cashierToken));
    expect(list.body.data).toHaveLength(1);
    await api().post(`/api/payments/${p.id}/verify`).set(auth(f.ownerToken)).send({}).expect(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).verification).toBe('VERIFIED');
  });

  it('flags orders whose shift was closed before they synced', async () => {
    await api().post(`/api/shifts/${shiftId}/close`).set(auth(f.cashierToken)).send({ countedCashCentavos: 100000 }).expect(200);
    const [r] = (await sync([offlineOrder()])).body.data.results;
    expect(r.status).toBe('SYNCED');
    expect(r.conflicts).toContain('SHIFT_CLOSED');
  });

  it('downgrades an unpaid "completed" offline order to READY', async () => {
    const [r] = (await sync([offlineOrder({ payments: [] })])).body.data.results;
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: r.orderId } });
    expect(saved.status).toBe('READY');
    expect(saved.paymentStatus).toBe('UNPAID');
  });

  it('lets the owner review and resolve conflicts', async () => {
    await api().patch(`/api/variants/${f.smallId}`).set(auth(f.ownerToken)).send({ priceCentavos: 5500 }).expect(200);
    await sync([offlineOrder()]);
    const list = await api().get('/api/sync/conflicts?status=OPEN').set(auth(f.ownerToken));
    expect(list.body.data).toHaveLength(1);
    const id = list.body.data[0].id;
    await api().post(`/api/sync/conflicts/${id}/resolve`).set(auth(f.ownerToken)).send({ resolution: 'Accepted old price' }).expect(200);
    expect((await api().post(`/api/sync/conflicts/${id}/resolve`).set(auth(f.ownerToken)).send({ resolution: 'again' })).status).toBe(409);
  });

  it('rejects oversized batches', async () => {
    const res = await sync(Array.from({ length: 51 }, () => offlineOrder()));
    expect(res.status).toBe(400);
  });
});
