import express from 'express';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import { ApiError, sendProblem } from '../http/errors.js';
import { createOrderMetadata, getOrderMetadata } from '../services/orderMetadataService.js';

const router = express.Router();

router.post('/orders/metadata', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet', 'https://cylos.io/errors/unauthorized');
    const data = await createOrderMetadata(req.body ?? {});
    res.status(201).json(data);
  } catch (error) { next(error); }
});

router.get('/orders/metadata/:on_chain_order_id', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet', 'https://cylos.io/errors/unauthorized');
    const data = await getOrderMetadata(req.params['on_chain_order_id']!, req.walletAddress);
    res.status(200).json(data);
  } catch (error) { next(error); }
});

export function orderErrorHandler(error: unknown, req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (error instanceof ApiError) { sendProblem(res, req, error); return; }
  next(error);
}

export default router;
