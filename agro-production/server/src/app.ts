import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import logger from './config/logger.js';
import { config } from './config/index.js';
import { defaultLimiter } from './middleware/rateLimit.js';
import campaignImageRoutes, {
  campaignImageErrorHandler,
} from './routes/campaignImageRoutes.js';
import campaignRoutes from './routes/campaigns.js';
import orderRoutes from './routes/orders.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(defaultLimiter);

// Campaign image upload/delete (Issue #155)
app.use(campaignImageRoutes);

// Campaign and order REST endpoints
app.use('/api/v1', campaignRoutes);
app.use('/api/v1', orderRoutes);

app.get('/health', (_req: Request, res: Response) => {
  logger.info('Health check endpoint hit');
  res.json({
    status: 'UP',
    service: 'agro-production-server',
    env: config.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(campaignImageErrorHandler);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled request error', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
