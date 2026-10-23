/**
 * DEMO SEED — for trying the system out only.
 *
 * Every price, recipe quantity, cost, delivery fee and stock level below is
 * ILLUSTRATIVE DEMO DATA, not the shop's real figures. Before going live,
 * replace them from the Menu, Inventory and Settings pages (or start from an
 * empty database and use `npm run db:setup-owner`).
 *
 * Usage: npm run db:seed            (refuses to run when NODE_ENV=production)
 *        SEED_OWNER_PASSWORD=... SEED_CASHIER_PASSWORD=... npm run db:seed
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient, type Unit } from '@prisma/client';
import { stockIn } from '../src/services/inventory.service';
import { updateSettings } from '../src/lib/settings';

const prisma = new PrismaClient();
const D = (v: number | string) => new Prisma.Decimal(v);
const DEMO_NOTE = 'DEMO DATA — replace with the real price and recipe';

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    throw new Error('Refusing to seed demo data in production. Use npm run db:setup-owner instead.');
  }
  if ((await prisma.order.count()) > 0) {
    throw new Error('Database already has orders; demo seed skipped to protect real data.');
  }

  const ownerPw = process.env.SEED_OWNER_PASSWORD ?? 'owner12345';
  const cashierPw = process.env.SEED_CASHIER_PASSWORD ?? 'cashier12345';
  const owner = await prisma.user.upsert({
    where: { username: 'owner' },
    update: {},
    create: { name: 'Demo Owner', username: 'owner', role: 'OWNER', passwordHash: await bcrypt.hash(ownerPw, 12) },
  });
  await prisma.user.upsert({
    where: { username: 'cashier' },
    update: {},
    create: { name: 'Demo Cashier', username: 'cashier', role: 'CASHIER', passwordHash: await bcrypt.hash(cashierPw, 12) },
  });

  await updateSettings(prisma, {});

  // Delivery areas (demo fees)
  for (const a of [
    { name: 'Cordova', feeCentavos: 3000 },
    { name: 'Lapu-Lapu City', feeCentavos: 5000 },
  ]) {
    await prisma.deliveryArea.upsert({ where: { name: a.name }, update: {}, create: a });
  }

  // Ingredients with demo opening stock: [name, baseUnit, threshold, qty, unit, totalCost(centavos), expiresInDays?]
  const ingredientDefs: [string, Unit, number, number, Unit, number, number?][] = [
    ['Cup 16oz (Small)', 'PCS', 50, 300, 'PCS', 300 * 250],
    ['Cup 22oz (Medium)', 'PCS', 50, 300, 'PCS', 300 * 300],
    ['Cup 32oz (Large)', 'PCS', 50, 200, 'PCS', 200 * 400],
    ['Dome lid', 'PCS', 80, 800, 'PCS', 800 * 80],
    ['Straw', 'PCS', 100, 1000, 'PCS', 1000 * 30],
    ['Milk tea powder', 'G', 500, 5, 'KG', 5 * 45000],
    ['Tapioca pearls', 'G', 500, 5, 'KG', 5 * 18000, 20],
    ['Coffee base', 'G', 300, 2, 'KG', 2 * 60000],
    ['Fresh milk', 'ML', 2000, 12, 'L', 12 * 9500, 5],
    ['Sugar syrup', 'ML', 1000, 5, 'L', 5 * 8000],
    ['Fruit syrup', 'ML', 1000, 5, 'L', 5 * 25000],
    ['Soda water', 'ML', 2000, 12, 'L', 12 * 6000],
    ['Cream cheese', 'G', 500, 2, 'KG', 2 * 55000, 10],
    ['Chocolate powder', 'G', 500, 3, 'KG', 3 * 40000],
    ['Takoyaki batter mix', 'G', 1000, 10, 'KG', 10 * 12000],
    ['Octopus', 'G', 500, 3, 'KG', 3 * 50000, 4],
    ['Cheese (shredded)', 'G', 300, 2, 'KG', 2 * 45000, 14],
    ['Takoyaki boat', 'PCS', 50, 300, 'PCS', 300 * 400],
    ['Rice', 'G', 2000, 25, 'KG', 25 * 5500],
    ['Red Horse 500ml', 'PCS', 12, 48, 'PCS', 48 * 6500],
    ['San Mig Light 330ml', 'PCS', 12, 48, 'PCS', 48 * 5500],
  ];
  const ing: Record<string, string> = {};
  for (const [name, baseUnit, threshold, qty, unit, cost, expiresInDays] of ingredientDefs) {
    const created = await prisma.ingredient.upsert({
      where: { name },
      update: {},
      create: { name, baseUnit, lowStockThreshold: D(threshold) },
    });
    ing[name] = created.id;
    if (created.stockQty.eq(0)) {
      const factor = unit === 'KG' || unit === 'L' ? 1000 : 1;
      await prisma.$transaction((tx) =>
        stockIn(tx, {
          ingredientId: created.id,
          baseQuantity: D(qty * factor),
          totalCostCentavos: cost,
          type: 'OPENING',
          expiryDate: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
          userId: owner.id,
          reason: 'Demo opening stock',
        }),
      );
    }
  }

  const modifiers: Record<string, string> = {};
  for (const [name, price, recipe] of [
    ['Extra pearls', 1000, [['Tapioca pearls', 30]]],
    ['Cream cheese foam', 1500, [['Cream cheese', 20]]],
    ['Extra cheese', 1000, [['Cheese (shredded)', 15]]],
  ] as [string, number, [string, number][]][]) {
    const m = await prisma.modifier.upsert({ where: { name }, update: {}, create: { name, priceCentavos: price } });
    modifiers[name] = m.id;
    await prisma.recipeItem.deleteMany({ where: { modifierId: m.id } });
    await prisma.recipeItem.createMany({ data: recipe.map(([i, q]) => ({ modifierId: m.id, ingredientId: ing[i], quantity: D(q) })) });
  }

  // Drink cup recipes per size, plus base ingredients per product.
  const cupBySize: Record<string, string> = { Small: 'Cup 16oz (Small)', Medium: 'Cup 22oz (Medium)', Large: 'Cup 32oz (Large)' };
  const sizeFactor: Record<string, number> = { Small: 1, Medium: 1.3, Large: 1.6 };
  type ProductDef = {
    name: string;
    variants: [string, number][];
    base: [string, number][];
    drink?: boolean;
    mods?: string[];
  };
  const sizes = (s: number, m: number, l: number): [string, number][] => [['Small', s], ['Medium', m], ['Large', l]];
  const menu: Record<string, ProductDef[]> = {
    'Milk Tea': ['Classic', 'Wintermelon', 'Okinawa', 'Matcha'].map((n) => ({
      name: `${n} Milk Tea`,
      variants: sizes(4900, 5900, 6900),
      base: [['Milk tea powder', 30], ['Tapioca pearls', 50], ['Sugar syrup', 20]],
      drink: true,
      mods: ['Extra pearls', 'Cream cheese foam'],
    })),
    'Iced Coffee': ['Caramel Macchiato', 'Spanish Latte'].map((n) => ({
      name: n,
      variants: sizes(6900, 7900, 8900),
      base: [['Coffee base', 18], ['Fresh milk', 150], ['Sugar syrup', 20]],
      drink: true,
    })),
    'Fruit Soda': ['Strawberry', 'Blueberry', 'Green Apple'].map((n) => ({
      name: `${n} Fruit Soda`,
      variants: sizes(4900, 5900, 6900),
      base: [['Fruit syrup', 40], ['Soda water', 250]],
      drink: true,
    })),
    'Frappe': ['Cookies & Cream', 'Mocha'].map((n) => ({
      name: `${n} Frappe`,
      variants: sizes(8500, 9500, 10500),
      base: [['Fresh milk', 150], ['Chocolate powder', 25], ['Sugar syrup', 20]],
      drink: true,
    })),
    'Cheesecake Series': ['Oreo', 'Strawberry'].map((n) => ({
      name: `${n} Cheesecake`,
      variants: sizes(6500, 7500, 8500),
      base: [['Milk tea powder', 25], ['Cream cheese', 30], ['Tapioca pearls', 40]],
      drink: true,
      mods: ['Extra pearls'],
    })),
    'Chocolate Series': ['Dark Chocolate', 'Nutella Chocolate'].map((n) => ({
      name: n,
      variants: sizes(6900, 7900, 8900),
      base: [['Chocolate powder', 35], ['Fresh milk', 180]],
      drink: true,
    })),
    'Takoyaki': ['Octopus', 'Cheese', 'Bacon', 'Crab', 'Shrimp', 'Ham'].map((n) => ({
      name: `${n} Takoyaki`,
      variants: [['4 pcs', 5000], ['8 pcs', 9500]],
      base: [['Takoyaki batter mix', 40], ...(n === 'Octopus' ? ([['Octopus', 20]] as [string, number][]) : []), ...(n === 'Cheese' ? ([['Cheese (shredded)', 20]] as [string, number][]) : []), ['Takoyaki boat', 1]],
      mods: ['Extra cheese'],
    })),
    'Rice Meals': ['Gambas with Rice', 'Lumpia with Rice'].map((n) => ({
      name: n,
      variants: [['Regular', 18000]],
      base: [['Rice', 150]],
    })),
    'Beer': [
      { name: 'Red Horse 500ml', variants: [['Bottle', 9000]], base: [['Red Horse 500ml', 1]] },
      { name: 'San Mig Light 330ml', variants: [['Bottle', 8000]], base: [['San Mig Light 330ml', 1]] },
    ],
  };

  let catOrder = 0;
  for (const [catName, products] of Object.entries(menu)) {
    const cat = await prisma.category.upsert({ where: { name: catName }, update: {}, create: { name: catName, sortOrder: catOrder++ } });
    let pOrder = 0;
    for (const p of products) {
      const existing = await prisma.product.findUnique({ where: { categoryId_name: { categoryId: cat.id, name: p.name } } });
      if (existing) continue;
      const product = await prisma.product.create({
        data: {
          categoryId: cat.id,
          name: p.name,
          description: DEMO_NOTE,
          sortOrder: pOrder++,
          variants: { create: p.variants.map(([name, priceCentavos], i) => ({ name, priceCentavos, sortOrder: i })) },
          modifiers: p.mods ? { create: p.mods.map((m) => ({ modifierId: modifiers[m] })) } : undefined,
        },
        include: { variants: true },
      });
      for (const v of product.variants) {
        const f = p.drink ? sizeFactor[v.name] ?? 1 : v.name === '8 pcs' ? 2 : 1;
        const lines = new Map<string, number>();
        for (const [i, q] of p.base) lines.set(ing[i], q === 1 && !p.drink ? q * f : Math.round(q * f));
        if (p.drink) {
          lines.set(ing[cupBySize[v.name]], 1);
          lines.set(ing['Dome lid'], 1);
          lines.set(ing['Straw'], 1);
        }
        await prisma.recipeItem.createMany({
          data: [...lines.entries()].map(([ingredientId, quantity]) => ({ variantId: v.id, ingredientId, quantity: D(quantity) })),
        });
      }
    }
  }

  console.log('Demo data seeded. ALL prices, costs, recipes and fees are illustrative — edit them before real use.');
  console.log('Demo logins: owner / cashier (passwords from SEED_*_PASSWORD or the defaults in prisma/seed.ts). Change them immediately.');
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
