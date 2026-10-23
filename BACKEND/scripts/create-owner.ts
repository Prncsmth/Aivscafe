/**
 * Create the first owner account on an empty (production) database.
 *
 *   OWNER_NAME="Aiv" OWNER_USERNAME=aiv OWNER_PASSWORD='a-strong-password' npm run db:setup-owner
 *
 * The password is read from the environment so it never appears in shell history arguments or logs.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const name = process.env.OWNER_NAME?.trim();
  const username = process.env.OWNER_USERNAME?.trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD;
  if (!name || !username || !password) {
    throw new Error('Set OWNER_NAME, OWNER_USERNAME and OWNER_PASSWORD environment variables.');
  }
  if (password.length < 8) throw new Error('OWNER_PASSWORD must be at least 8 characters.');
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('OWNER_USERNAME: 3-40 letters, numbers, dot, dash or underscore.');
  if (await prisma.user.findUnique({ where: { username } })) throw new Error(`User "${username}" already exists.`);

  await prisma.user.create({
    data: { name, username, role: 'OWNER', passwordHash: await bcrypt.hash(password, 12) },
  });
  console.log(`Owner account "${username}" created.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
