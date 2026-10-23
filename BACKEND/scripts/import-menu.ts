/**
 * Import the real menu from prisma/menu.json (or a path given as the first argument).
 *
 *   npm run menu:import                 # import / update
 *   npm run menu:import -- --dry-run    # show what would change, write nothing
 *
 * - Prices in the file are pesos; they are stored as centavos.
 * - Safe to run again: existing categories/products/sizes are matched by name and their prices updated.
 * - Entries with price null are skipped and listed, so nothing unconfirmed reaches the POS.
 * - Recipes and stock are not part of this file — add them on the Menu & Prices and Purchases pages.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { bumpCatalogVersion } from '../src/lib/settings';

const peso = z.number().nonnegative().max(1_000_000).nullable();
const MenuSchema = z.object({
  categories: z.array(
    z.object({
      name: z.string().min(1),
      products: z.array(
        z.object({
          name: z.string().min(1),
          note: z.string().optional(),
          variants: z.array(z.tuple([z.string().min(1), peso])).min(1),
        }),
      ),
    }),
  ),
  deliveryAreas: z.array(z.object({ name: z.string().min(1), fee: peso, note: z.string().optional() })).default([]),
});

const toCentavos = (p: number) => Math.round(p * 100);

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const file = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'prisma/menu.json');
  const menu = MenuSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  const prisma = new PrismaClient();
  const skipped: string[] = [];
  const changes: string[] = [];

  try {
    await prisma.$transaction(
      async (tx) => {
        for (const [ci, c] of menu.categories.entries()) {
          const category =
            (await tx.category.findUnique({ where: { name: c.name } })) ??
            (dryRun ? null : await tx.category.create({ data: { name: c.name, sortOrder: ci } }));
          if (!category) changes.push(`+ category ${c.name}`);
          for (const [pi, p] of c.products.entries()) {
            const ready = p.variants.filter(([, price]) => price != null);
            p.variants.filter(([, price]) => price == null).forEach(([v]) => skipped.push(`${c.name} / ${p.name} / ${v}`));
            if (!ready.length) continue;
            let product = category ? await tx.product.findUnique({ where: { categoryId_name: { categoryId: category.id, name: p.name } } }) : null;
            if (!product) {
              changes.push(`+ product ${c.name} / ${p.name}`);
              if (!dryRun && category) product = await tx.product.create({ data: { categoryId: category.id, name: p.name, sortOrder: pi } });
            }
            for (const [vi, [vName, price]] of ready.entries()) {
              const cents = toCentavos(price!);
              const existing = product ? await tx.productVariant.findUnique({ where: { productId_name: { productId: product.id, name: vName } } }) : null;
              if (!existing) {
                changes.push(`+ ${p.name} ${vName} ₱${price}`);
                if (!dryRun && product) await tx.productVariant.create({ data: { productId: product.id, name: vName, priceCentavos: cents, sortOrder: vi } });
              } else if (existing.priceCentavos !== cents) {
                changes.push(`~ ${p.name} ${vName} ₱${existing.priceCentavos / 100} → ₱${price}`);
                if (!dryRun) await tx.productVariant.update({ where: { id: existing.id }, data: { priceCentavos: cents } });
              }
            }
          }
        }
        for (const a of menu.deliveryAreas) {
          if (a.fee == null) {
            skipped.push(`Delivery area ${a.name}`);
            continue;
          }
          const cents = toCentavos(a.fee);
          const existing = await tx.deliveryArea.findUnique({ where: { name: a.name } });
          if (!existing) changes.push(`+ delivery area ${a.name} ₱${a.fee}`);
          else if (existing.feeCentavos !== cents) changes.push(`~ delivery area ${a.name} ₱${existing.feeCentavos / 100} → ₱${a.fee}`);
          if (!dryRun) await tx.deliveryArea.upsert({ where: { name: a.name }, create: { name: a.name, feeCentavos: cents }, update: { feeCentavos: cents } });
        }
        if (!dryRun && changes.length) {
          await bumpCatalogVersion(tx);
          await tx.auditLog.create({ data: { action: 'MENU_IMPORTED', entity: 'Product', details: { file: path.basename(file), changes } } });
        }
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  } finally {
    await prisma.$disconnect();
  }

  console.log(dryRun ? 'DRY RUN — nothing was written.\n' : 'Menu imported.\n');
  console.log(changes.length ? changes.join('\n') : 'No changes.');
  if (skipped.length) console.log(`\nSkipped (price not filled in yet):\n  ${skipped.join('\n  ')}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
