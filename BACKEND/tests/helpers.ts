import request from 'supertest';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { updateSettings } from '../src/lib/settings';

export const app = createApp();
export const api = () => request(app);

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
}

const hash = bcrypt.hashSync('password123', 4);

export async function createUser(username: string, role: 'OWNER' | 'CASHIER') {
  return prisma.user.create({ data: { name: username, username, role, passwordHash: hash } });
}

export async function login(username: string): Promise<string> {
  const res = await api().post('/api/auth/login').send({ username, password: 'password123' });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface Fixture {
  ownerToken: string;
  cashierToken: string;
  ownerId: string;
  cashierId: string;
  cupId: string;
  powderId: string;
  pearlsId: string;
  productId: string;
  smallId: string;
  largeId: string;
  pearlsModId: string;
  areaId: string;
}

/**
 * Minimal catalog:
 *  Milk Tea — Small ₱49 (1 cup + 30 g powder), Large ₱69 (1 cup + 50 g powder)
 *  Add-on "Extra pearls" ₱10 (20 g pearls)
 *  Stock: 10 cups, 300 g powder, 1000 g pearls. Powder cost ₱0.50/g, cup ₱3.00.
 */
export async function setupFixture(): Promise<Fixture> {
  await resetDb();
  const owner = await createUser('owner', 'OWNER');
  const cashier = await createUser('cashier', 'CASHIER');
  const D = (n: number) => new Prisma.Decimal(n);

  const cup = await prisma.ingredient.create({ data: { name: 'Cup', baseUnit: 'PCS', stockQty: D(10), avgUnitCost: D(300), lowStockThreshold: D(3) } });
  const powder = await prisma.ingredient.create({ data: { name: 'Powder', baseUnit: 'G', stockQty: D(300), avgUnitCost: D(50), lowStockThreshold: D(60) } });
  const pearls = await prisma.ingredient.create({ data: { name: 'Pearls', baseUnit: 'G', stockQty: D(1000), avgUnitCost: D(20) } });
  const cat = await prisma.category.create({ data: { name: 'Milk Tea' } });
  const mod = await prisma.modifier.create({ data: { name: 'Extra pearls', priceCentavos: 1000 } });
  await prisma.recipeItem.create({ data: { modifierId: mod.id, ingredientId: pearls.id, quantity: D(20) } });
  const product = await prisma.product.create({
    data: {
      categoryId: cat.id,
      name: 'Classic Milk Tea',
      variants: { create: [{ name: 'Small', priceCentavos: 4900 }, { name: 'Large', priceCentavos: 6900 }] },
      modifiers: { create: [{ modifierId: mod.id }] },
    },
    include: { variants: true },
  });
  const small = product.variants.find((v) => v.name === 'Small')!;
  const large = product.variants.find((v) => v.name === 'Large')!;
  await prisma.recipeItem.createMany({
    data: [
      { variantId: small.id, ingredientId: cup.id, quantity: D(1) },
      { variantId: small.id, ingredientId: powder.id, quantity: D(30) },
      { variantId: large.id, ingredientId: cup.id, quantity: D(1) },
      { variantId: large.id, ingredientId: powder.id, quantity: D(50) },
    ],
  });
  const area = await prisma.deliveryArea.create({ data: { name: 'Cordova', feeCentavos: 3000 } });
  // Most tests exercise the full order queue / delivery flow; walk-in-only mode has its own tests.
  await updateSettings(prisma, { walkInOnly: false });

  return {
    ownerToken: await login('owner'),
    cashierToken: await login('cashier'),
    ownerId: owner.id,
    cashierId: cashier.id,
    cupId: cup.id,
    powderId: powder.id,
    pearlsId: pearls.id,
    productId: product.id,
    smallId: small.id,
    largeId: large.id,
    pearlsModId: mod.id,
    areaId: area.id,
  };
}

export async function openShift(token: string, startingCashCentavos = 100000) {
  const res = await api().post('/api/shifts/open').set(auth(token)).send({ startingCashCentavos });
  if (res.status !== 201) throw new Error(`open shift failed: ${JSON.stringify(res.body)}`);
  return res.body.data.shift.id as string;
}

export async function stockOf(id: string): Promise<number> {
  const i = await prisma.ingredient.findUniqueOrThrow({ where: { id } });
  return i.stockQty.toNumber();
}

export const uuid = () => randomUUID();
