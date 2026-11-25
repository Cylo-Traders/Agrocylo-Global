import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import cors from 'cors';
import { corsOptions } from './config/cors.js';
import helmet from 'helmet';
import logger from './config/logger.js';
import { config } from './config/index.js';
import { initializeSentry } from './config/observability.js';
import { prisma } from './config/database.js';
import { getSupabaseAdmin, isSupabaseConfigured } from './config/supabase.js';
import { incrementRequestCount, incrementErrorCount } from './services/metricsService.js';
import { ApiError, sendProblem } from './http/errors.js';
import { Sentry } from './config/sentry.js';
import { requestContext } from './middleware/requestContext.js';
import { requestLogger } from './middleware/requestLogger.js';
import { createIdempotencyMiddleware } from './middleware/idempotency.js';
import { sharedRedisClient } from './middleware/rateLimiter.js';
import productImageRoutes, { productImageErrorHandler } from './routes/productImageRoutes.js';
import productRoutes, { apiErrorHandler } from './routes/productRoutes.js';
import cartRoutes from './routes/cartRoutes.js';
import authRoutes from './routes/authRoutes.js';
import orderRoutes, { orderErrorHandler } from './routes/orderRoutes.js';
import orderMetadataRoutes from './routes/orderMetadataRoutes.js';
import profileRoutes, { profileErrorHandler } from './routes/profileRoutes.js';
import graphqlRoutes, { graphqlErrorHandler } from './routes/graphqlRoutes.js';
import locationRoutes, { locationErrorHandler } from './routes/locationRoutes.js';
import notificationRoutes, { notificationErrorHandler } from './routes/notificationRoutes.js';
import jobRoutes from './routes/jobRoutes.js';
import demandSupplyRoutes from './routes/demandSupplyRoutes.js';
import marketRoutes from './routes/marketRoutes.js';
import metricsRoutes from './routes/metricsRoutes.js';
import adminRoutes, { adminErrorHandler } from './routes/adminRoutes.js';
import adminReconciliationRoutes from './routes/adminReconciliationRoutes.js';
import disputeRoutes, { disputeUploadErrorHandler } from './routes/disputeRoutes.js';
import cropPlanRoutes from './routes/cropPlanRoutes.js';
import equipmentRoutes from './routes/equipmentRoutes.js';
import groupOrderRoutes, { groupOrderErrorHandler } from './routes/groupOrderRoutes.js';
import referralRoutes, { referralErrorHandler } from './routes/referralRoutes.js';
import integratorRoutes, { integratorErrorHandler } from './routes/integratorRoutes.js';
import analyticsRoutes, { analyticsErrorHandler } from './routes/analyticsRoutes.js';
import governanceRoutes from './routes/governanceRoutes.js';
import ussdRoutes from './routes/ussdRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import { registerAllEndpoints } from './openapi/endpoints.js';
import { getIndexerStatus } from './services/indexerStatus.js';

// Initialize error tracking and tracing
initializeSentry('api');

const app = express();

// Sentry request handler must be the first middleware (Sentry v8 removed Handlers — guard for tests)
if (
  (Sentry as unknown as { Handlers?: { requestHandler: () => import('express').Handler } }).Handlers
    ?.requestHandler
) {
  app.use(
    (
      Sentry as unknown as { Handlers: { requestHandler: () => import('express').Handler } }
    ).Handlers.requestHandler()
  );
}

// Trust proxy to correctly extract client IP from X-Forwarded-For
app.set('trust proxy', 1);

// Security headers middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts:
      config.nodeEnv === 'production'
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
  })
);

app.use(cors(corsOptions));
app.use(express.json());
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));
app.use(requestContext);
app.use(requestLogger);

// Idempotency middleware (if Redis is available)
if (sharedRedisClient) {
  app.use(createIdempotencyMiddleware(sharedRedisClient));
}

// Metrics middleware
app.use((_req, _res, next) => {
  incrementRequestCount();
  next();
});

app.use('/auth', authRoutes);
app.use(productImageRoutes);
app.use(productRoutes);
app.use(cartRoutes);
app.use('/orders', orderRoutes);
app.use('/orders/metadata', orderMetadataRoutes);
app.use(profileRoutes);
app.use(locationRoutes);
app.use(notificationRoutes);
app.use('/disputes', disputeRoutes);
app.use(groupOrderRoutes);
app.use('/graphql', graphqlRoutes);
app.use(demandSupplyRoutes);
app.use(marketRoutes);
app.use(analyticsRoutes);
app.use(jobRoutes);
app.use(cropPlanRoutes);
app.use(equipmentRoutes);
app.use('/admin', adminRoutes);
app.use('/admin/reconciliation', adminReconciliationRoutes);
app.use(referralRoutes);
app.use(integratorRoutes);
app.use(governanceRoutes);
app.use(ussdRoutes);

// Documentation endpoints (OpenAPI spec and Swagger UI)
registerAllEndpoints(); // Populate the OpenAPI registry
app.use(documentRoutes);

function buildLivenessPayload() {
  return {
    status: 'UP' as const,
    timestamp: new Date().toISOString(),
    service: 'Agrocylo-Backend',
    env: config.nodeEnv,
  };
}

// Liveness endpoint (#1423): process is up and serving HTTP.
// Does not fail on placeholder Supabase credentials or unconfigured external dependencies.
app.get('/health/live', (_req: Request, res: Response) => {
  res.status(200).json(buildLivenessPayload());
});

// Backwards-compatible liveness alias (#1423).
app.get('/health', (_req: Request, res: Response) => {
  logger.info('Health check endpoint hit');
  res.status(200).json(buildLivenessPayload());
});

// Readiness endpoint (#1423): verifies required dependencies (Postgres + optional Supabase when configured).
app.get('/health/ready', async (_req: Request, res: Response) => {
  const supabaseEnabled = isSupabaseConfigured();
  const health: {
    status: 'UP' | 'DOWN';
    timestamp: string;
    service: string;
    env: string;
    database: 'UP' | 'DOWN';
    supabase: 'UP' | 'DOWN' | 'DISABLED';
  } = {
    status: 'UP',
    timestamp: new Date().toISOString(),
    service: 'Agrocylo-Backend',
    env: config.nodeEnv,
    database: 'DOWN',
    supabase: supabaseEnabled ? 'DOWN' : 'DISABLED',
  };

  // Check database connectivity
  try {
    // Raw SQL is limited to this static health probe; it accepts no user input or dynamic parameters.
    await prisma.$queryRaw`SELECT 1`;
    health.database = 'UP';
  } catch (error) {
    logger.error('Database readiness check failed', error);
    health.status = 'DOWN';
  }

  // Only require Supabase in readiness when real Supabase credentials are configured (#1423).
  if (supabaseEnabled) {
    try {
      const supabase = getSupabaseAdmin();
      const { error } = await supabase.from('profiles').select('count').limit(1).maybeSingle();
      if (!error) {
        health.supabase = 'UP';
      } else {
        logger.error('Supabase readiness check failed', error);
        health.status = 'DOWN';
      }
    } catch (error) {
      logger.error('Supabase readiness check failed', error);
      health.status = 'DOWN';
    }
  }

  const statusCode = health.status === 'UP' ? 200 : 503;
  res.status(statusCode).json(health);
});

app.get('/health/indexer', async (_req: Request, res: Response) => {
  try {
    const status = await getIndexerStatus();
    const healthy = status.status === 'fresh' || status.status === 'disabled';
    res.status(healthy ? 200 : 503).json(status);
  } catch (error) {
    logger.error('Indexer health check failed', error);
    res.status(503).json({ enabled: config.runContractWatcher, status: 'unknown' });
  }
});

app.use(metricsRoutes);

// Sentry error handler (v8): captures errors with request context, then
// forwards to the next handler — must be registered after all routes.
Sentry.setupExpressErrorHandler(app);

app.use(productImageErrorHandler);
app.use(disputeUploadErrorHandler);
app.use(apiErrorHandler);
app.use(profileErrorHandler);
app.use(locationErrorHandler);
app.use(analyticsErrorHandler);
app.use(orderErrorHandler);
app.use(notificationErrorHandler);
app.use(groupOrderErrorHandler);
app.use(graphqlErrorHandler);
app.use(adminErrorHandler);
app.use(referralErrorHandler);
app.use(integratorErrorHandler);

// Sentry error handler must be before other error handlers (guard for v8)
if (
  (
    Sentry as unknown as {
      Handlers?: { errorHandler: () => import('express').ErrorRequestHandler };
    }
  ).Handlers?.errorHandler
) {
  app.use(
    (
      Sentry as unknown as {
        Handlers: { errorHandler: () => import('express').ErrorRequestHandler };
      }
    ).Handlers.errorHandler()
  );
}

app.use((err: unknown, req: Request, res: Response, _next: () => void) => {
  incrementErrorCount();
  if (err instanceof ApiError) {
    // Client-facing API errors (4xx/5xx with a deliberate ApiError) are
    // expected control flow, not incidents — only report actual 5xx ApiErrors
    // to Sentry, so validation/auth/not-found noise doesn't drown real alerts.
    if (err.status >= 500) {
      Sentry.captureException(err);
    }
    sendProblem(res, req, err);
    return;
  }
  logger.error('Unhandled request error', err);
  Sentry.captureException(err);
  sendProblem(res, req, new ApiError(500, 'Internal Server Error', 'An unexpected error occurred'));
});

export default app;
