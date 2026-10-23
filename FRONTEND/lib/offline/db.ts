import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { OfflineOrderPayload } from '../pos/cart';

/**
 * Durable on-device storage (IndexedDB). Survives reloads and browser restarts.
 * - outbox: every order created while offline, until the server confirms it
 * - kv:     cached catalog, settings, current shift, device id, temp-receipt counter, cached user
 */

export type SyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

export interface OutboxRecord {
  clientId: string;
  payload: OfflineOrderPayload;
  status: SyncStatus;
  attempts: number;
  /** epoch ms; automatic retries wait until then */
  nextAttemptAt: number;
  retryable: boolean;
  lastError: { code: string; message: string } | null;
  serverReference: string | null;
  serverOrderId: string | null;
  conflicts: string[];
  createdAt: number;
  updatedAt: number;
  syncedAt: number | null;
}

interface PosSchema extends DBSchema {
  outbox: { key: string; value: OutboxRecord; indexes: { byStatus: SyncStatus; byCreated: number } };
  kv: { key: string; value: unknown };
}

export type PosDb = IDBPDatabase<PosSchema>;

export function openPosDb(name = 'aivs-pos'): Promise<PosDb> {
  return openDB<PosSchema>(name, 1, {
    upgrade(db) {
      const outbox = db.createObjectStore('outbox', { keyPath: 'clientId' });
      outbox.createIndex('byStatus', 'status');
      outbox.createIndex('byCreated', 'createdAt');
      db.createObjectStore('kv');
    },
  });
}

export async function kvGet<T>(db: PosDb, key: string): Promise<T | undefined> {
  return (await db.get('kv', key)) as T | undefined;
}

export async function kvSet(db: PosDb, key: string, value: unknown): Promise<void> {
  await db.put('kv', value, key);
}

export async function kvDelete(db: PosDb, key: string): Promise<void> {
  await db.delete('kv', key);
}

/** Stable per-device id, created once. */
export async function getDeviceId(db: PosDb): Promise<string> {
  const existing = await kvGet<string>(db, 'deviceId');
  if (existing) return existing;
  const id = crypto.randomUUID();
  await kvSet(db, 'deviceId', id);
  return id;
}

/** Next temporary receipt reference, e.g. OFF-3F2A-0007. Atomic within one IndexedDB transaction. */
export async function nextTempReference(db: PosDb): Promise<string> {
  const deviceId = await getDeviceId(db);
  const tx = db.transaction('kv', 'readwrite');
  const seq = (((await tx.store.get('tempSeq')) as number | undefined) ?? 0) + 1;
  await tx.store.put(seq, 'tempSeq');
  await tx.done;
  return `OFF-${deviceId.slice(0, 4).toUpperCase()}-${String(seq).padStart(4, '0')}`;
}
