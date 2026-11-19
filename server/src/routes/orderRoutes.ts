import { Router, type Request, type Response, type NextFunction } from 'express';
import { OrderController } from '../controllers/orderController.js';
import { ApiError, sendProblem } from '../http/errors.js';
import { requireWallet } from '../middleware/walletAuth.js';

const router = Router();

router.get('/', requireWallet, OrderController.getAllOrders);

router.get('/buyer/:address', requireWallet, OrderController.getOrdersByBuyer);

router.get('/seller/:address', requireWallet, OrderController.getOrdersBySeller);

router.get('/stats/:sellerAddress', requireWallet, OrderController.getSellerStats);

router.get('/:id', requireWallet, OrderController.getOrderById);

export function orderErrorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (error instanceof ApiError) {
    sendProblem(res, req, error);
    return;
  }
  next(error);
}

export default router;
