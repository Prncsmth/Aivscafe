import { beforeEach, describe, expect, it } from 'vitest';
import { openPosDb, getDeviceId, nextTempReference, type PosDb } from '@/lib/offline/db';
import { SyncEngine, type SyncResult, type SyncTransport } from '@/lib/offline/sync-engine';
import { NetworkError } from '@/lib/api';
import { toOfflinePayload, type CheckoutDraft, type OfflineOrderPayload } from '@/lib/pos/cart';

/**
 * A fake backend with the same idempotency contract as POST /api/sync/orders:
 * clientId is unique; a repeat returns the first result; stock is deducted once per order.
 */
class FakeServer implements SyncTransport {
  orders = new Map<string, { reference: string; conflicts: string[] }>();
  cups = 100;
  price = 4900;
  seq = 0;
  calls = 0;
  /** behaviour switches */
  offline = false;
  dropResponseAfterProcessing = false;
  rejectClientIds = new Set<string>();
  serverErrorOnce = new Set<string>();

  async send(_deviceId: string, orders: OfflineOrderPayload[]): Promise<SyncResult[]> {
    this.calls++;
    if (this.offline) throw new NetworkError();
    const results: SyncResult[] = orders.map((o) => {
      const existing = this.orders.get(o.clientId);
      if (existing) return { clientId: o.clientId, status: 'SYNCED', duplicate: true, orderId: o.clientId, ...existing };
      if (this.rejectClientIds.has(o.clientId)) {
        return { clientId: o.clientId, status: 'FAILED', retryable: false, error: { code: 'TOTAL_MISMATCH', message: 'Order totals do not add up' } };
      }
      if (this.serverErrorOnce.has(o.clientId)) {
        this.serverErrorOnce.delete(o.clientId);
        return { clientId: o.clientId, status: 'FAILED', retryable: true, error: { code: 'SERVER_ERROR', message: 'Temporary server error' } };
      }
      const conflicts: string[] = [];
      if (o.items.some((i) => i.unitPriceCentavos !== this.price)) conflicts.push('PRICE_MISMATCH');
      const need = o.items.reduce((s, i) => s + i.quantity, 0);
      if (need > this.cups) conflicts.push('INSUFFICIENT_STOCK');
      this.cups -= need;
      const rec = { reference: `AIV-20251023-${String(++this.seq).padStart(4, '0')}`, conflicts };
      this.orders.set(o.clientId, rec);
      return { clientId: o.clientId, status: 'SYNCED', duplicate: false, orderId: o.clientId, ...rec };
    });
    if (this.dropResponseAfterProcessing) {
      this.dropResponseAfterProcessing = false;
      throw new NetworkError('Connection dropped before the response arrived');
    }
    return results;
  }
}

let dbName: string;
let db: PosDb;
let server: FakeServer;
let clock: number;

function makeEngine(database: PosDb) {
  return new SyncEngine(database, server, () => getDeviceId(database), {
    now: () => clock,
    random: () => 0.5,
    baseDelayMs: 1000,
    maxAutoAttempts: 3,
  });
}

function draft(over: Partial<CheckoutDraft> = {}): CheckoutDraft {
  return {
    clientId: crypto.randomUUID(),
    type: 'WALK_IN',
    lines: [
      { key: 'k', variantId: 'v-small', productName: 'Classic Milk Tea', variantName: 'Small', unitPriceCentavos: 4900, modifiers: [], quantity: 2 },
    ],
    discountCentavos: 0,
    deliveryFeeCentavos: 0,
    payments: [{ method: 'CASH', amountCentavos: 9800, tenderedCentavos: 10000 }],
    ...over,
  };
}

async function createOfflineOrder(engine: SyncEngine, database: PosDb, over: Partial<CheckoutDraft> = {}) {
  const payload = toOfflinePayload(draft(over), {
    tempReference: await nextTempReference(database),
    catalogVersion: 7,
    shiftId: 'shift-1',
    status: 'COMPLETED',
  });
  return engine.enqueue(payload);
}

beforeEach(async () => {
  dbName = `test-${crypto.randomUUID()}`;
  db = await openPosDb(dbName);
  server = new FakeServer();
  clock = 1_000_000;
});

describe('offline order creation', () => {
  it('stores the order durably with totals, temp reference and catalog version', async () => {
    server.offline = true;
    const engine = makeEngine(db);
    const rec = await createOfflineOrder(engine, db);
    expect(rec.status).toBe('PENDING');
    expect(rec.payload.totalCentavos).toBe(9800);
    expect(rec.payload.tempReference).toMatch(/^OFF-[0-9A-F]{4}-0001$/);
    expect(rec.payload.catalogVersion).toBe(7);
    expect(await engine.unsyncedCount()).toBe(1);

    // syncing while offline keeps it — never discarded
    const run = await engine.sync();
    expect(run.networkError).toBe(true);
    const [after] = await engine.all();
    expect(after.status).toBe('FAILED');
    expect(after.retryable).toBe(true);
    expect(after.serverReference).toBeNull();
  });

  it('issues increasing temporary receipt references', async () => {
    const a = await nextTempReference(db);
    const b = await nextTempReference(db);
    expect(Number(a.slice(-4)) + 1).toBe(Number(b.slice(-4)));
  });
});

describe('reload with pending orders', () => {
  it('keeps pending orders across a reload and recovers orders interrupted mid-sync', async () => {
    server.offline = true;
    const engine = makeEngine(db);
    await createOfflineOrder(engine, db);
    await createOfflineOrder(engine, db);
    // Simulate a crash in the middle of a sync: one record left as SYNCING.
    const [first] = await engine.all();
    await db.put('outbox', { ...first, status: 'SYNCING' });
    db.close();

    // "Reload": a brand-new connection and engine on the same IndexedDB database.
    const reopened = await openPosDb(dbName);
    const engine2 = makeEngine(reopened);
    expect(await engine2.recoverInterrupted()).toBe(1);
    const rows = await engine2.all();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'PENDING')).toBe(true);
    expect(await getDeviceId(reopened)).toBe(await getDeviceId(reopened));

    server.offline = false;
    const run = await engine2.sync();
    expect(run.synced).toBe(2);
  });
});

describe('reconnect and synchronise', () => {
  it('marks orders synced only after the server acknowledges them', async () => {
    const engine = makeEngine(db);
    const rec = await createOfflineOrder(engine, db);
    expect((await engine.all())[0].serverReference).toBeNull();
    const run = await engine.sync();
    expect(run).toMatchObject({ attempted: 1, synced: 1, failed: 0 });
    const [after] = await engine.all();
    expect(after.status).toBe('SYNCED');
    expect(after.serverReference).toBe('AIV-20251023-0001');
    expect(after.clientId).toBe(rec.clientId);
    expect(await engine.unsyncedCount()).toBe(0);
  });
});

describe('duplicate and lost-response safety', () => {
  it('re-sending the same order does not create a second order or deduct stock twice', async () => {
    const engine = makeEngine(db);
    const rec = await createOfflineOrder(engine, db);
    await engine.sync();
    // Force a re-send of an already-synced order (e.g. user hit retry on another device copy).
    await db.put('outbox', { ...(await db.get('outbox', rec.clientId))!, status: 'PENDING' });
    await engine.sync({ manual: true });
    expect(server.orders.size).toBe(1);
    expect(server.cups).toBe(98);
    expect((await engine.all())[0].serverReference).toBe('AIV-20251023-0001');
  });

  it('server processed the order but the response was lost: the retry is answered as a duplicate', async () => {
    const engine = makeEngine(db);
    await createOfflineOrder(engine, db);
    server.dropResponseAfterProcessing = true;
    const first = await engine.sync();
    expect(first.networkError).toBe(true);
    expect((await engine.all())[0].status).toBe('FAILED'); // not claimed as confirmed
    expect(server.orders.size).toBe(1); // ...although the server has it

    clock += 60_000;
    const second = await engine.sync();
    expect(second.synced).toBe(1);
    expect(server.orders.size).toBe(1);
    expect(server.cups).toBe(98); // inventory deducted exactly once
    expect((await engine.all())[0].serverReference).toBe('AIV-20251023-0001');
  });

  it('enqueueing the same clientId twice keeps one record', async () => {
    const engine = makeEngine(db);
    const payload = toOfflinePayload(draft(), { tempReference: 'OFF-X-1', catalogVersion: 1, shiftId: null, status: 'PENDING' });
    await engine.enqueue(payload);
    await engine.enqueue(payload);
    expect(await engine.all()).toHaveLength(1);
  });

  it('concurrent sync calls share one run (no double send)', async () => {
    const engine = makeEngine(db);
    await createOfflineOrder(engine, db);
    await Promise.all([engine.sync(), engine.sync(), engine.sync()]);
    expect(server.calls).toBe(1);
  });
});

describe('partial failures', () => {
  it('applies each result independently', async () => {
    const engine = makeEngine(db);
    const good = await createOfflineOrder(engine, db);
    clock += 1;
    const bad = await createOfflineOrder(engine, db);
    clock += 1;
    const flaky = await createOfflineOrder(engine, db);
    server.rejectClientIds.add(bad.clientId);
    server.serverErrorOnce.add(flaky.clientId);

    const run = await engine.sync();
    expect(run).toMatchObject({ synced: 1, failed: 2 });
    const byId = new Map((await engine.all()).map((r) => [r.clientId, r]));
    expect(byId.get(good.clientId)!.status).toBe('SYNCED');
    expect(byId.get(bad.clientId)).toMatchObject({ status: 'FAILED', retryable: false, lastError: { code: 'TOTAL_MISMATCH' } });
    expect(byId.get(flaky.clientId)).toMatchObject({ status: 'FAILED', retryable: true });

    // automatic retry later picks up only the retryable one
    clock += 60_000;
    const retry = await engine.sync();
    expect(retry.attempted).toBe(1);
    expect((await db.get('outbox', flaky.clientId))!.status).toBe('SYNCED');
    expect((await db.get('outbox', bad.clientId))!.status).toBe('FAILED');
  });
});

describe('price and stock conflicts', () => {
  it('reports server-flagged conflicts and keeps the offline price', async () => {
    server.price = 5500; // price changed on the server while this device was offline
    server.cups = 1;
    const engine = makeEngine(db);
    const rec = await createOfflineOrder(engine, db);
    await engine.sync();
    const after = (await db.get('outbox', rec.clientId))!;
    expect(after.status).toBe('SYNCED');
    expect(after.conflicts).toEqual(['PRICE_MISMATCH', 'INSUFFICIENT_STOCK']);
    expect(after.payload.items[0].unitPriceCentavos).toBe(4900);
    expect(after.payload.catalogVersion).toBe(7);
  });
});

describe('retries', () => {
  it('backs off exponentially and stops automatic retries after the limit', async () => {
    server.offline = true;
    const engine = makeEngine(db);
    await createOfflineOrder(engine, db);

    await engine.sync();
    let [r] = await engine.all();
    expect(r.attempts).toBe(1);
    expect(r.nextAttemptAt - clock).toBe(1000);

    // not due yet => nothing attempted
    expect((await engine.sync()).attempted).toBe(0);

    clock = r.nextAttemptAt;
    await engine.sync();
    [r] = await engine.all();
    expect(r.attempts).toBe(2);
    expect(r.nextAttemptAt - clock).toBe(2000);

    clock = r.nextAttemptAt;
    await engine.sync();
    [r] = await engine.all();
    expect(r.attempts).toBe(3);

    clock += 10 * 60_000;
    expect((await engine.sync()).attempted).toBe(0); // limit reached: waits for manual retry

    server.offline = false;
    const manual = await engine.sync({ manual: true });
    expect(manual.synced).toBe(1);
  });

  it('manual retry also re-sends non-retryable failures once the data is fixed server-side', async () => {
    const engine = makeEngine(db);
    const rec = await createOfflineOrder(engine, db);
    server.rejectClientIds.add(rec.clientId);
    await engine.sync();
    expect((await db.get('outbox', rec.clientId))!.status).toBe('FAILED');
    clock += 10 * 60_000;
    expect((await engine.sync()).attempted).toBe(0);
    server.rejectClientIds.clear();
    expect((await engine.sync({ manual: true })).synced).toBe(1);
  });

  it('never prunes unsynced orders', async () => {
    server.offline = true;
    const engine = makeEngine(db);
    await createOfflineOrder(engine, db);
    clock += 30 * 86_400_000;
    expect(await engine.pruneSynced()).toBe(0);
    expect(await engine.unsyncedCount()).toBe(1);
  });
});
