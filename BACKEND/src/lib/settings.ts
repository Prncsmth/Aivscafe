import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Db } from './prisma';

/**
 * Configurable business settings. Defaults are placeholders — the owner adjusts
 * them from the Settings page. Nothing here is a verified fact about the shop.
 */
export const SettingsSchema = z.object({
  /** BLOCK: refuse online orders that would make stock negative (an owner may override).
   *  ALLOW: accept and record negative stock with a warning. */
  insufficientStockPolicy: z.enum(['BLOCK', 'ALLOW']).default('BLOCK'),
  /** Maximum discount a cashier may give, as a percent of subtotal. Owners are unlimited. */
  maxCashierDiscountPercent: z.number().min(0).max(100).default(20),
  /** Absolute shift cash variance (centavos) above which owner review is required. */
  cashVarianceReviewThresholdCentavos: z.number().int().min(0).default(5000),
  /** Prefix for order references, e.g. AIV-20251023-0001 */
  orderPrefix: z.string().min(1).max(8).regex(/^[A-Z0-9]+$/).default('AIV'),
  /** Days before expiry at which batches are flagged as "expiring soon". */
  expiryWarningDays: z.number().int().min(0).max(365).default(3),
  shopName: z.string().min(1).max(120).default("Aiv's Cafe"),
  /** Paid walk-in orders are recorded as Completed right away (no Pending → Preparing → Ready steps). */
  autoCompleteWalkIn: z.boolean().default(true),
  /**
   * Walk-in only shop: every sale is a paid walk-in sale, completed at the counter.
   * No order queue, delivery or Messenger orders. Turn off to enable them.
   */
  walkInOnly: z.boolean().default(true),
});
export type Settings = z.infer<typeof SettingsSchema>;

const SETTINGS_KEY = 'business';
const CATALOG_VERSION_KEY = 'catalogVersion';

export async function getSettings(db: Db): Promise<Settings> {
  const row = await db.setting.findUnique({ where: { key: SETTINGS_KEY } });
  return SettingsSchema.parse(row?.value ?? {});
}

export async function updateSettings(db: Db, patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings(db);
  const next = SettingsSchema.parse({ ...current, ...patch });
  await db.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: next as Prisma.InputJsonValue },
    update: { value: next as Prisma.InputJsonValue },
  });
  return next;
}

export async function getCatalogVersion(db: Db): Promise<number> {
  const row = await db.setting.findUnique({ where: { key: CATALOG_VERSION_KEY } });
  return typeof row?.value === 'number' ? row.value : 1;
}

/** Call inside the same transaction as any change to products, variants, modifiers or prices. */
export async function bumpCatalogVersion(db: Db): Promise<number> {
  const next = (await getCatalogVersion(db)) + 1;
  await db.setting.upsert({
    where: { key: CATALOG_VERSION_KEY },
    create: { key: CATALOG_VERSION_KEY, value: next },
    update: { value: next },
  });
  return next;
}
