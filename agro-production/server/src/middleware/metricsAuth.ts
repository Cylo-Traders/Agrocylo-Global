import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/index.js';

export function requireMetricsAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const isProduction = config.nodeEnv === 'production';

  if (!config.metricsApiKey) {
    if (isProduction) {
      res
        .status(401)
        .json({ message: 'Unauthorized: metrics API key not configured' });
      return;
    }
    next();
    return;
  }

  const header = req.header('x-metrics-api-key');
  if (header !== config.metricsApiKey) {
    res.status(401).json({
      message: 'Unauthorized: invalid or missing x-metrics-api-key header',
    });
    return;
  }
  next();
}
