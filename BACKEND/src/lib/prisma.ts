import { PrismaClient, Prisma } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : process.env.NODE_ENV === 'test' ? [] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

/** Write transaction with timeouts that tolerate Neon's network latency. */
export function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { maxWait: 10_000, timeout: 20_000 });
}
