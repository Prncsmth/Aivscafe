import type { OfflineOrderPayload } from '../pos/cart';
import type { OutboxRecord, PosDb } from './db';

/** Per-order result returned by POST /api/sync/orders */
export type SyncResult =
  | { clientId: string; status: 'SYNCED'; duplicate: boolean; orderId: string; reference: string; conflicts: string[] }
  | { clientId: string | null; status: 'FAILED'; retryable: boolean; error: { code: string; message: string } };

export interface SyncTransport {
  /** Must throw on network failure / no response. Resolves only with the server's per-order results. */
  send(deviceId: string, orders: OfflineOrderPayload[]): Promise<SyncResult[]>;
}

export interface SyncEngineOptions {
  maxAutoAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  batchSize?: number;
  now?: () => number;
  random?: () => number;
}

export interface SyncRunSummary {
  attempted: number;
  synced: number;
  failed: number;
  networkError: boolean;
}

/**
 * Offline outbox + synchronisation.
 *
 * Guarantees
 * - An order is written to IndexedDB before the cashier sees "saved"; it is never deleted until
 *   the server has acknowledged it (synced records are kept for history and pruned after 7 days).
 * - Each order keeps the same clientId (idempotency key) for every retry, so a request that
 *   succeeded on the server but whose response was lost is answered as a duplicate — never re-created.
 * - Results are applied per order: one failure never blocks the others.
 * - Automatic retries use exponential backoff and stop after maxAutoAttempts; a manual retry resets them.
 * - Non-retryable failures (invalid data) wait for a manual retry and are shown to the user.
 */
export class SyncEngine {
  private running: Promise<SyncRunSummary> | null = null;
  private listeners = new Set<() => void>();
  private readonly opts: Required<SyncEngineOptions>;

  constructor(
    private readonly db: PosDb,
    private readonly transport: SyncTransport,
    private readonly getDeviceId: () => Promise<string>,
    options: SyncEngineOptions = {},
  ) {
    this.opts = {
      maxAutoAttempts: 8,
      baseDelayMs: 2_000,
      maxDelayMs: 5 * 60_000,
      batchSize: 20,
      now: () => Date.now(),
      random: Math.random,
      ...options,
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  backoffMs(attempts: number): number {
    const exp = Math.min(this.opts.maxDelayMs, this.opts.baseDelayMs * 2 ** Math.max(0, attempts - 1));
    return Math.round(exp * (0.8 + this.opts.random() * 0.4));
  }

  /** Durably store a new offline order. Re-enqueueing the same clientId is a no-op. */
  async enqueue(payload: OfflineOrderPayload): Promise<OutboxRecord> {
    const tx = this.db.transaction('outbox', 'readwrite');
    const existing = await tx.store.get(payload.clientId);
    if (existing) {
      await tx.done;
      return existing;
    }
    const now = this.opts.now();
    const record: OutboxRecord = {
      clientId: payload.clientId,
      payload,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: now,
      retryable: true,
      lastError: null,
      serverReference: null,
      serverOrderId: null,
      conflicts: [],
      createdAt: now,
      updatedAt: now,
      syncedAt: null,
    };
    await tx.store.put(record);
    await tx.done;
    this.emit();
    return record;
  }

  /** After a crash or reload mid-sync, SYNCING records go back to PENDING (safe thanks to idempotency). */
  async recoverInterrupted(): Promise<number> {
    const stuck = await this.db.getAllFromIndex('outbox', 'byStatus', 'SYNCING');
    for (const r of stuck) await this.db.put('outbox', { ...r, status: 'PENDING', updatedAt: this.opts.now() });
    if (stuck.length) this.emit();
    return stuck.length;
  }

  async all(): Promise<OutboxRecord[]> {
    const rows = await this.db.getAllFromIndex('outbox', 'byCreated');
    return rows.reverse();
  }

  async unsyncedCount(): Promise<number> {
    const [p, s, f] = await Promise.all([
      this.db.countFromIndex('outbox', 'byStatus', 'PENDING'),
      this.db.countFromIndex('outbox', 'byStatus', 'SYNCING'),
      this.db.countFromIndex('outbox', 'byStatus', 'FAILED'),
    ]);
    return p + s + f;
  }

  private async due(manual: boolean): Promise<OutboxRecord[]> {
    const now = this.opts.now();
    const pending = await this.db.getAllFromIndex('outbox', 'byStatus', 'PENDING');
    const failed = await this.db.getAllFromIndex('outbox', 'byStatus', 'FAILED');
    const retry = failed.filter((r) =>
      manual ? true : r.retryable && r.attempts < this.opts.maxAutoAttempts && r.nextAttemptAt <= now,
    );
    return [...pending.filter((r) => manual || r.nextAttemptAt <= now), ...retry]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, this.opts.batchSize);
  }

  /** Run one sync pass. Concurrent calls share the same run. */
  sync(options: { manual?: boolean } = {}): Promise<SyncRunSummary> {
    if (!this.running) {
      this.running = this.runOnce(!!options.manual).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async runOnce(manual: boolean): Promise<SyncRunSummary> {
    const batch = await this.due(manual);
    const summary: SyncRunSummary = { attempted: batch.length, synced: 0, failed: 0, networkError: false };
    if (!batch.length) return summary;

    const startedAt = this.opts.now();
    for (const r of batch) {
      await this.db.put('outbox', { ...r, status: 'SYNCING', attempts: manual ? 0 : r.attempts, updatedAt: startedAt });
    }
    this.emit();

    let results: SyncResult[];
    try {
      results = await this.transport.send(await this.getDeviceId(), batch.map((r) => r.payload));
    } catch (e) {
      // No acknowledgement: nothing is assumed. Every order stays unsynced and will be re-sent with the same clientId.
      summary.networkError = true;
      for (const r of batch) {
        const cur = (await this.db.get('outbox', r.clientId))!;
        const attempts = cur.attempts + 1;
        await this.db.put('outbox', {
          ...cur,
          status: 'FAILED',
          retryable: true,
          attempts,
          nextAttemptAt: this.opts.now() + this.backoffMs(attempts),
          lastError: { code: 'NETWORK', message: e instanceof Error ? e.message : 'Network error' },
          updatedAt: this.opts.now(),
        });
      }
      summary.failed = batch.length;
      this.emit();
      return summary;
    }

    const byId = new Map(results.filter((r) => r.clientId).map((r) => [r.clientId as string, r]));
    for (const r of batch) {
      const cur = (await this.db.get('outbox', r.clientId))!;
      const res = byId.get(r.clientId);
      const now = this.opts.now();
      if (res?.status === 'SYNCED') {
        await this.db.put('outbox', {
          ...cur,
          status: 'SYNCED',
          retryable: false,
          lastError: null,
          serverReference: res.reference,
          serverOrderId: res.orderId,
          conflicts: res.conflicts,
          syncedAt: now,
          updatedAt: now,
        });
        summary.synced++;
      } else {
        const attempts = cur.attempts + 1;
        const retryable = res ? res.retryable : true;
        await this.db.put('outbox', {
          ...cur,
          status: 'FAILED',
          retryable,
          attempts,
          nextAttemptAt: now + this.backoffMs(attempts),
          lastError: res ? res.error : { code: 'NO_RESULT', message: 'The server did not return a result for this order' },
          updatedAt: now,
        });
        summary.failed++;
      }
    }
    this.emit();
    return summary;
  }

  /** Remove server-confirmed records older than maxAgeMs. Unsynced records are never pruned. */
  async pruneSynced(maxAgeMs = 7 * 86_400_000): Promise<number> {
    const synced = await this.db.getAllFromIndex('outbox', 'byStatus', 'SYNCED');
    const cutoff = this.opts.now() - maxAgeMs;
    let n = 0;
    for (const r of synced) {
      if ((r.syncedAt ?? 0) < cutoff) {
        await this.db.delete('outbox', r.clientId);
        n++;
      }
    }
    if (n) this.emit();
    return n;
  }
}
