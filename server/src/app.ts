import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import logger from './config/logger.js';
import { config } from './config/index.js';
import productImageRoutes, { productImageErrorHandler } from './routes/productImageRoutes.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(productImageRoutes);

// Health check
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

app.use((err: unknown, _req: Request, res: Response, _next: () => void) => {
    logger.error('Unhandled request error', err);
    res.status(500).json({ message: 'Internal server error' });
});

export default app;
