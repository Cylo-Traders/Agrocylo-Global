import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import logger from './config/logger.js';
import { config } from './config/index.js';
import { ApiError, sendProblem } from './http/errors.js';
import productImageRoutes, { productImageErrorHandler } from './routes/productImageRoutes.js';
import productRoutes from './routes/productRoutes.js';
import cartRoutes from './routes/cartRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import orderRoutes from './routes/orderRoutes.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use(productImageRoutes);
app.use(productRoutes);
app.use(cartRoutes);
app.use(notificationRoutes);
app.use("/orders", orderRoutes);

app.get('/health', (req: Request, res: Response) => {
  logger.info('Health check endpoint hit');
  res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    service: 'Agrocylo-Backend',
    env: config.nodeEnv,
  });
});

app.use(productImageErrorHandler);
app.use((err: unknown, req: Request, res: Response, _next: () => void) => {
    if (err instanceof ApiError) {
      sendProblem(res, req, err);
      return;
    }

    logger.error('Unhandled request error', err);
    res.status(500).json({ message: 'Internal server error' });
});

export default app;
