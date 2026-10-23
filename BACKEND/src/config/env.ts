import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  BUSINESS_TIMEZONE: z.string().default('Asia/Manila'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // Only report which variables are invalid — never print their values.
  const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${problems}`);
}

// Production must not start with weak or placeholder settings.
if (parsed.data.NODE_ENV === 'production') {
  const problems: string[] = [];
  const secret = parsed.data.JWT_ACCESS_SECRET;
  if (secret.length < 32 || /change-me|paste-a-long|secret/i.test(secret)) problems.push('JWT_ACCESS_SECRET must be a long random value (32+ characters)');
  const origins = parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim());
  if (origins.some((o) => !o.startsWith('https://') || /YOUR-FRONTEND|localhost/i.test(o))) problems.push('CORS_ORIGINS must list your real https:// frontend URL(s)');
  if (!(process.env.COOKIE_SECURE === 'true' || parsed.data.COOKIE_SAMESITE === 'none')) problems.push('COOKIE_SECURE must be true in production');
  if (problems.length) throw new Error(`Unsafe production configuration:\n  - ${problems.join('\n  - ')}`);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
};
