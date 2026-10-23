'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { API_URL, ApiError, NetworkError, api } from '../api';
import { useAuth } from '../auth';
import type { Catalog, Settings, ShiftSummary } from '../types';
import { toOfflinePayload, type CheckoutDraft } from '../pos/cart';
import type { OrderStatus } from '../types';
import { getDeviceId, kvGet, kvSet, nextTempReference, openPosDb, type OutboxRecord, type PosDb } from './db';
import { SyncEngine, type SyncResult, type SyncRunSummary } from './sync-engine';

interface CachedShift {
  id: string;
  userId: string;
  openedAt: string;
}

interface PosState {
  ready: boolean;
  online: boolean;
  catalog: Catalog | null;
  catalogSavedAt: number | null;
  settings: Settings | null;
  shift: CachedShift | null;
  records: OutboxRecord[];
  unsyncedCount: number;
  syncing: boolean;
  lastSync: { at: number; summary: SyncRunSummary } | null;
  refreshCatalog: () => Promise<Catalog | null>;
  refreshShift: () => Promise<ShiftSummary | null>;
  setShift: (s: CachedShift | null) => Promise<void>;
  saveOffline: (draft: CheckoutDraft, status: OrderStatus) => Promise<OutboxRecord>;
  syncNow: (manual?: boolean) => Promise<SyncRunSummary | null>;
}

const PosContext = createContext<PosState | null>(null);

/** Connectivity = browser says online AND the API answers /health. navigator.onLine alone lies on captive Wi-Fi. */
function useConnectivity() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      if (!navigator.onLine) return alive && setOnline(false);
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(`${API_URL}/health`, { cache: 'no-store', signal: controller.signal });
        // 503 = API up but database unreachable: orders cannot be saved, so treat as offline.
        if (alive) setOnline(res.ok);
      } catch {
        if (alive) setOnline(false);
      } finally {
        clearTimeout(t);
      }
    };
    void ping();
    const interval = setInterval(ping, 20_000);
    const on = () => void ping();
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      alive = false;
      clearInterval(interval);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function PosProvider({ children }: { children: ReactNode }) {
  const { user, offlineSession } = useAuth();
  const online = useConnectivity() && !offlineSession;
  const [db, setDb] = useState<PosDb | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogSavedAt, setCatalogSavedAt] = useState<number | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [shift, setShiftState] = useState<CachedShift | null>(null);
  const [records, setRecords] = useState<OutboxRecord[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<PosState['lastSync']>(null);

  // Open IndexedDB, build the engine, load caches.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const database = await openPosDb();
      if (cancelled) return;
      const engine = new SyncEngine(
        database,
        {
          send: async (deviceId, orders) => {
            const r = await api.post<{ results: SyncResult[] }>('/sync/orders', { deviceId, orders });
            return r.results;
          },
        },
        () => getDeviceId(database),
      );
      await engine.recoverInterrupted();
      await engine.pruneSynced();
      engineRef.current = engine;
      const refresh = async () => setRecords(await engine.all());
      engine.subscribe(() => void refresh());
      await refresh();
      const cached = await kvGet<{ catalog: Catalog; savedAt: number }>(database, 'catalog');
      if (cached) {
        setCatalog(cached.catalog);
        setCatalogSavedAt(cached.savedAt);
      }
      setSettings((await kvGet<Settings>(database, 'settings')) ?? null);
      setShiftState((await kvGet<CachedShift>(database, 'shift')) ?? null);
      setDb(database);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshCatalog = useCallback(async () => {
    if (!db) return null;
    try {
      const [c, s] = await Promise.all([api.get<Catalog>('/catalog'), api.get<Settings>('/settings')]);
      const savedAt = Date.now();
      await kvSet(db, 'catalog', { catalog: c, savedAt });
      await kvSet(db, 'settings', s);
      setCatalog(c);
      setCatalogSavedAt(savedAt);
      setSettings(s);
      return c;
    } catch (e) {
      if (e instanceof NetworkError) return null; // keep the cached copy
      throw e;
    }
  }, [db]);

  const setShift = useCallback(
    async (s: CachedShift | null) => {
      setShiftState(s);
      if (db) await kvSet(db, 'shift', s);
    },
    [db],
  );

  const refreshShift = useCallback(async () => {
    try {
      const s = await api.get<ShiftSummary | null>('/shifts/current');
      await setShift(s ? { id: s.shift.id, userId: s.shift.userId, openedAt: s.shift.openedAt } : null);
      return s;
    } catch (e) {
      if (e instanceof NetworkError) return null;
      throw e;
    }
  }, [setShift]);

  // Refresh caches whenever we are online and signed in.
  useEffect(() => {
    if (!db || !user || !online) return;
    void refreshCatalog().catch(() => {});
    void refreshShift().catch(() => {});
    const t = setInterval(() => void refreshCatalog().catch(() => {}), 5 * 60_000);
    return () => clearInterval(t);
  }, [db, user, online, refreshCatalog, refreshShift]);

  const saveOffline = useCallback(
    async (draft: CheckoutDraft, status: OrderStatus) => {
      if (!db || !engineRef.current) throw new Error('Offline storage is not ready yet');
      const payload = toOfflinePayload(draft, {
        tempReference: await nextTempReference(db),
        catalogVersion: catalog?.version ?? 0,
        shiftId: shift?.userId === user?.id ? (shift?.id ?? null) : null,
        status,
      });
      return engineRef.current.enqueue(payload);
    },
    [db, catalog, shift, user],
  );

  const syncNow = useCallback(
    async (manual = false) => {
      const engine = engineRef.current;
      if (!engine || !user) return null;
      setSyncing(true);
      try {
        const summary = await engine.sync({ manual });
        if (summary.attempted) setLastSync({ at: Date.now(), summary });
        return summary;
      } catch (e) {
        if (e instanceof ApiError || e instanceof NetworkError) return null;
        throw e;
      } finally {
        setSyncing(false);
      }
    },
    [user],
  );

  const unsyncedCount = records.filter((r) => r.status !== 'SYNCED').length;

  // Automatic sync: on reconnect and every 15 s while there is something to send.
  useEffect(() => {
    if (!online || !user || !unsyncedCount) return;
    void syncNow();
    const t = setInterval(() => void syncNow(), 15_000);
    return () => clearInterval(t);
  }, [online, user, unsyncedCount, syncNow]);

  return (
    <PosContext.Provider
      value={{
        ready: !!db,
        online,
        catalog,
        catalogSavedAt,
        settings,
        shift,
        records,
        unsyncedCount,
        syncing,
        lastSync,
        refreshCatalog,
        refreshShift,
        setShift,
        saveOffline,
        syncNow,
      }}
    >
      {children}
    </PosContext.Provider>
  );
}

export function usePos() {
  const ctx = useContext(PosContext);
  if (!ctx) throw new Error('usePos must be used inside PosProvider');
  return ctx;
}
