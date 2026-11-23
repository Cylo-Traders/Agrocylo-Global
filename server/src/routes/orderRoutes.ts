import { Router, type Request, type Response, type NextFunction } from 'express';
import { OrderController } from '../controllers/orderController.js';
import { ApiError, sendProblem } from '../http/errors.js';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import { prisma } from '../config/database.js';

const router = Router();

router.get('/', requireWallet, OrderController.getAllOrders);

router.get('/buyer/:address', requireWallet, OrderController.getOrdersByBuyer);

router.get('/seller/:address', requireWallet, OrderController.getOrdersBySeller);

router.get('/stats/:sellerAddress', requireWallet, OrderController.getSellerStats);

router.get(
  '/by-transaction/:txHash',
  requireWallet,
  async (req: WalletRequest, res: Response, next: NextFunction) => {
    try {
      const indexed = await prisma.blockchainTransaction.findFirst({
        where: {
          txHash: req.params.txHash,
          eventType: 'order.created',
          orderIdOnChain: { not: null },
        },
        orderBy: { ledger: 'desc' },
        select: { orderIdOnChain: true },
      });
      const orderId = indexed?.orderIdOnChain;
      if (!orderId) {
        sendProblem(
          res,
          req,
          new ApiError(404, 'Not Found', 'Order not yet indexed for this transaction')
        );
        return;
      }
      const order = await prisma.order.findUnique({
        where: { orderIdOnChain: orderId },
        select: { orderIdOnChain: true, buyerAddress: true },
      });
      const owner = order?.buyerAddress?.trim().toLowerCase();
      if (!order?.orderIdOnChain || owner !== req.walletAddress?.trim().toLowerCase()) {
        sendProblem(
          res,
          req,
          new ApiError(404, 'Not Found', 'Order not yet indexed for this transaction')
        );
        return;
      }
      res.status(200).json({ orderId: order.orderIdOnChain });
    } catch (error) {
      next(error);
    }
  }
);

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
