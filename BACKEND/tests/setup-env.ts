import { inject } from 'vitest';

// Must run before the app (and Prisma) is imported by a test file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = inject('databaseUrl');
process.env.DIRECT_URL = inject('databaseUrl');
process.env.JWT_ACCESS_SECRET = 'test-secret-that-is-long-enough-123';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.BUSINESS_TIMEZONE = 'Asia/Manila';
