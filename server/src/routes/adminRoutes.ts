import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAdmin } from '../middleware/adminAuth.js';
import { AdminDisputeController } from '../controllers/adminDisputeController.js';
import { ApiError, sendProblem } from '../http/errors.js';
import logger from '../config/logger.js';

const router = Router();

router.use(requireAdmin);

router.get('/disputes', AdminDisputeController.getDisputes);
router.post('/resolve', AdminDisputeController.resolveDispute);

export function adminErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    sendProblem(res, req, err);
    return;
  }
  logger.error('[adminRoutes] Unhandled error', err);
  res.status(500).json({ message: 'Internal server error' });
}

export default router;
