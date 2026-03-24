import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import logger from './config/logger.js';
import { config } from './config/index.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

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

export default app;
