import express, { type Request, type Response } from 'express';
import cors from 'cors';
import logger from './config/logger.js';
import { config } from './config/index.js';
import { defaultLimiter } from './middleware/rateLimit.js';
import { jsonValidated } from './middleware/validate.js';
import { requireMetricsAuth } from './middleware/metricsAuth.js';
import { isGracefullyShuttingDown } from './services/lifecycle.js';
import campaignImageRoutes, {
  campaignImageErrorHandler,
} from './routes/campaignImageRoutes.js';
import campaignRoutes from './routes/campaigns.js';
import orderRoutes from './routes/orders.js';
import transactionRoutes from './routes/transactions.js';
import disputeRoutes from './routes/disputes.js';
import { globalErrorHandler } from './middleware/errors.js';
import { HealthResponseSchema, LivezResponseSchema, ReadyzResponseSchema } from './schemas/health.js';
import { serveOpenApiDocument } from './openapi/document.js';
import { getRateLimitMetrics } from './middleware/rateLimitMetrics.js';
import { getEventMetrics } from './events/metrics.js';
import { prisma } from './db/client.js';

const app = express();

const corsOptions: cors.CorsOptions = {
  origin:
    config.corsOrigins.length > 0
      ? config.corsOrigins
      : config.nodeEnv === 'production'
        ? false
        : '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-wallet-address', 'x-metrics-api-key', 'x-request-id'],
  credentials: config.nodeEnv === 'production' && config.corsOrigins.length > 0,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(defaultLimiter);

app.use((req: Request, _res: Response, next: express.NextFunction) => {
  if (isGracefullyShuttingDown() && req.method !== 'GET') {
    _res.status(503).json({ message: 'Server is shutting down' });
    return;
  }
  next();
});

app.use(campaignImageRoutes);
app.use('/api/v1', campaignRoutes);
app.use('/api/v1', orderRoutes);
app.use('/api/v1', transactionRoutes);
app.use('/api/v1', disputeRoutes);

app.get('/health', (_req: Request, res: Response) => {
  logger.info('Health check endpoint hit');
  jsonValidated(res, HealthResponseSchema, 200, {
    status: 'UP',
    service: 'agro-production-server',
    env: config.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

app.get('/livez', async (_req: Request, res: Response) => {
  jsonValidated(res, LivezResponseSchema, 200, {
    status: 'alive',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/readyz', async (_req: Request, res: Response) => {
  const checks: Record<string, { status: string; message?: string }> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'UP' };
  } catch (err) {
    checks.database = { status: 'DOWN', message: (err as Error).message };
  }

  const ready = Object.values(checks).every((c) => c.status === 'UP');
  const statusCode = ready ? 200 : 503;

  jsonValidated(res, ReadyzResponseSchema, statusCode, {
    status: ready ? 'ready' : 'not_ready',
    checks,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/docs/openapi.json', serveOpenApiDocument);

app.get('/metrics/rate-limits', requireMetricsAuth, (_req: Request, res: Response) => {
  res.status(200).json(getRateLimitMetrics());
});

app.get('/metrics/events', requireMetricsAuth, (_req: Request, res: Response) => {
  res.status(200).json(getEventMetrics());
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(campaignImageErrorHandler);

app.use(globalErrorHandler);

export default app;
