import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import type { TestProject } from 'vitest/node';

/**
 * Integration tests run against a real PostgreSQL:
 * - TEST_DATABASE_URL if provided (e.g. a disposable Neon branch — never production!)
 * - otherwise an embedded PostgreSQL started in the OS temp directory.
 * Migrations are applied with `prisma migrate deploy`, so the tests also verify the migrations.
 */
let pg: { stop: () => Promise<void> } | null = null;

/** Ask the OS for an unused port so we never collide with another local Postgres. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

export default async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const dir = path.join(os.tmpdir(), `sms-test-pg-${process.pid}`);
    fs.rmSync(dir, { recursive: true, force: true });
    const port = await freePort();
    const instance = new EmbeddedPostgres({
      databaseDir: dir,
      user: 'postgres',
      password: 'postgres',
      port,
      persistent: false,
      onLog: () => {},
    });
    await instance.initialise();
    await instance.start();
    await instance.createDatabase('sms_test');
    pg = instance;
    url = `postgresql://postgres:postgres@localhost:${port}/sms_test`;
  }
  // Non-destructive: the embedded database is brand new. Tests clear their own tables between cases.
  try {
    execSync('npx prisma migrate deploy', {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
      stdio: 'pipe',
    });
  } catch (e) {
    if (pg) await pg.stop();
    const err = e as { stderr?: Buffer };
    throw new Error(`prisma migrate deploy failed:\n${err.stderr?.toString() ?? e}`);
  }
  project.provide('databaseUrl', url);

  return async () => {
    if (pg) await pg.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
