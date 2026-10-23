/**
 * Import the real menu from prisma/menu.json (or a path given as the first argument).
 *
 *   npm run menu:import -- --dry-run                    # show what would change, write nothing
 *   npm run menu:import                                 # add new items, update prices and photos
 *   npm run menu:import -- --archive-missing            # also archive items no longer on the menu
 *
 * - Prices in the file are pesos; they are stored as centavos.
 * - Safe to run again: categories/products/sizes are matched by name.
 * - Entries with price null are skipped and listed, so nothing unconfirmed reaches the POS.
 * - --archive-missing only touches categories that appear in the file. Archived items disappear
 *   from the POS but stay in the database, so old receipts and reports are unchanged.
 * - Recipes and stock are not part of this file. Add them on the Menu & Prices and Purchases pages.
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
          /** photo served by the frontend, e.g. /menu/okinawa-milk-tea.jpg */
          image: z.string().regex(/^(\/|https:\/\/)/).optional(),
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
  const archiveMissing = args.includes('--archive-missing');
  const file = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'prisma/menu.json');
  const parsed = MenuSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));

  // The same category may appear twice in the file: merge them.
  const categories = new Map<string, (typeof parsed.categories)[number]['products']>();
  for (const c of parsed.categories) categories.set(c.name, [...(categories.get(c.name) ?? []), ...c.products]);

  const prisma = new PrismaClient();
  const skipped: string[] = [];
  const changes: string[] = [];

  try {
    await prisma.$transaction(
      async (tx) => {
        let ci = 0;
        for (const [catName, products] of categories) {
          let category = await tx.category.findUnique({ where: { name: catName } });
          if (!category) {
            changes.push(`+ category ${catName}`);
            if (!dryRun) category = await tx.category.create({ data: { name: catName, sortOrder: ci } });
          } else if (!category.isActive || category.sortOrder !== ci) {
            if (!category.isActive) changes.push(`* category ${catName} shown again`);
            if (!dryRun) await tx.category.update({ where: { id: category.id }, data: { isActive: true, sortOrder: ci } });
          }
          ci++;

          const keptProducts = new Set<string>();
          for (const [pi, p] of products.entries()) {
            const ready = p.variants.filter(([, price]) => price != null);
            p.variants.filter(([, price]) => price == null).forEach(([v]) => skipped.push(`${catName} / ${p.name} / ${v}`));
            if (!ready.length) continue;
            keptProducts.add(p.name);
            let product = category ? await tx.product.findUnique({ where: { categoryId_name: { categoryId: category.id, name: p.name } } }) : null;
            if (!product) {
              changes.push(`+ ${catName} / ${p.name}${p.image ? ' (photo)' : ''}`);
              if (!dryRun && category) {
                product = await tx.product.create({ data: { categoryId: category.id, name: p.name, sortOrder: pi, imageUrl: p.image ?? null } });
              }
            } else {
              const data: { isActive?: boolean; sortOrder?: number; imageUrl?: string | null } = {};
              if (!product.isActive) {
                data.isActive = true;
                changes.push(`* ${catName} / ${p.name} back on the menu`);
              }
              if (product.sortOrder !== pi) data.sortOrder = pi;
              if (p.image && product.imageUrl !== p.image) {
                data.imageUrl = p.image;
                changes.push(`photo: ${catName} / ${p.name}`);
              }
              if (Object.keys(data).length && !dryRun) await tx.product.update({ where: { id: product.id }, data });
            }

            const keptSizes = new Set<string>();
            for (const [vi, [vName, price]] of ready.entries()) {
              keptSizes.add(vName);
              const cents = toCentavos(price!);
              const existing = product ? await tx.productVariant.findUnique({ where: { productId_name: { productId: product.id, name: vName } } }) : null;
              if (!existing) {
                changes.push(`+ ${p.name} ${vName} P${price}`);
                if (!dryRun && product) await tx.productVariant.create({ data: { productId: product.id, name: vName, priceCentavos: cents, sortOrder: vi } });
              } else if (existing.priceCentavos !== cents || !existing.isActive || existing.sortOrder !== vi) {
                if (existing.priceCentavos !== cents) changes.push(`~ ${p.name} ${vName} P${existing.priceCentavos / 100} -> P${price}`);
                if (!existing.isActive) changes.push(`* ${p.name} ${vName} back on the menu`);
                if (!dryRun) await tx.productVariant.update({ where: { id: existing.id }, data: { priceCentavos: cents, isActive: true, sortOrder: vi } });
              }
            }
            // Sizes that are no longer on the menu for this product (e.g. a Large that was removed)
            if (archiveMissing && product) {
              const stale = await tx.productVariant.findMany({ where: { productId: product.id, isActive: true, name: { notIn: [...keptSizes] } } });
              for (const v of stale) {
                changes.push(`- ${p.name} ${v.name} archived`);
                if (!dryRun) await tx.productVariant.update({ where: { id: v.id }, data: { isActive: false } });
              }
            }
          }

          // Products in this category that are no longer on the menu
          if (archiveMissing && category) {
            const stale = await tx.product.findMany({ where: { categoryId: category.id, isActive: true, name: { notIn: [...keptProducts] } } });
            for (const s of stale) {
              changes.push(`- ${catName} / ${s.name} archived`);
              if (!dryRun) await tx.product.update({ where: { id: s.id }, data: { isActive: false } });
            }
          }
        }

        for (const a of parsed.deliveryAreas) {
          if (a.fee == null) {
            skipped.push(`Delivery area ${a.name}`);
            continue;
          }
          const cents = toCentavos(a.fee);
          const existing = await tx.deliveryArea.findUnique({ where: { name: a.name } });
          if (!existing) changes.push(`+ delivery area ${a.name} P${a.fee}`);
          else if (existing.feeCentavos !== cents) changes.push(`~ delivery area ${a.name} P${existing.feeCentavos / 100} -> P${a.fee}`);
          if (!dryRun) await tx.deliveryArea.upsert({ where: { name: a.name }, create: { name: a.name, feeCentavos: cents }, update: { feeCentavos: cents } });
        }
        if (!dryRun && changes.length) {
          await bumpCatalogVersion(tx);
          await tx.auditLog.create({ data: { action: 'MENU_IMPORTED', entity: 'Product', details: { file: path.basename(file), archiveMissing, changes } } });
        }
      },
      { timeout: 180_000, maxWait: 20_000 },
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
