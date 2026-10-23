import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup-env.ts'],
    // Integration tests share one database; run files sequentially.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
