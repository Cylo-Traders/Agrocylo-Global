import express, { type Request, type Response } from 'express';
import cors from 'cors';
import logger from './config/logger.js';
import { config } from './config/index.js';
import campaignImageRoutes, {
  campaignImageErrorHandler,
} from './routes/campaignImageRoutes.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use(campaignImageRoutes);

app.get('/health', (_req: Request, res: Response) => {
  logger.info('Health check endpoint hit');
  res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    service: 'Agrocylo-Production-Backend',
    env: config.nodeEnv,
  });
});

app.use(campaignImageErrorHandler);

app.use((err: unknown, _req: Request, res: Response, _next: () => void) => {
  logger.error('Unhandled request error', err);
  res.status(500).json({ message: 'Internal server error' });
});

export default app;
