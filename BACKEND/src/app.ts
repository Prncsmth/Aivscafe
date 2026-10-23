import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authenticate } from './middleware/auth';
import authRoutes from './modules/auth.routes';
import userRoutes from './modules/users.routes';
import catalogRoutes from './modules/catalog.routes';
import inventoryRoutes from './modules/inventory.routes';
import purchaseRoutes from './modules/purchases.routes';
import orderRoutes from './modules/orders.routes';
import shiftRoutes from './modules/shifts.routes';
import expenseRoutes from './modules/expenses.routes';
import reportRoutes from './modules/reports.routes';
import syncRoutes from './modules/sync.routes';
import adminRoutes from './modules/admin.routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        // Allow same-origin / server-to-server requests (no Origin header) and configured origins.
        if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  // API data is private and changes constantly: never let browsers or proxies cache it.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // Broad per-IP limit against scripted abuse (the POS polls every 10-20 s, far below this).
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: env.NODE_ENV === 'test' ? 100_000 : 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
    }),
  );
  app.use(cookieParser());
  if (env.NODE_ENV !== 'test') app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  app.get('/api/health', async (_req, res) => {
    let db = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'unreachable';
    }
    res.status(db === 'ok' ? 200 : 503).json({ success: db === 'ok', data: { status: 'ok', db, time: new Date().toISOString() } });
  });

  app.use('/api/auth', authRoutes);
  // Everything below requires a valid access token (verified once per request).
  app.use('/api', authenticate);
  app.use('/api/users', userRoutes);
  app.use('/api', catalogRoutes);
  app.use('/api', inventoryRoutes);
  app.use('/api', purchaseRoutes);
  app.use('/api', orderRoutes);
  app.use('/api', shiftRoutes);
  app.use('/api', expenseRoutes);
  app.use('/api', reportRoutes);
  app.use('/api', syncRoutes);
  app.use('/api', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
