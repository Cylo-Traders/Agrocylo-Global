import express from 'express';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import { ApiError, sendProblem } from '../http/errors.js';
import { listBuyerOrders, parseOrderStatusFilter } from '../services/ordersService.js';

const router = express.Router();

router.get('/orders', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet');
    const status = parseOrderStatusFilter(req.query['status']);
    const data = await listBuyerOrders(req.walletAddress, status);
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
});

export function ordersErrorHandler(
  error: unknown,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (error instanceof ApiError) {
    sendProblem(res, req, error);
    return;
  }
  next(error);
}

export default router;
