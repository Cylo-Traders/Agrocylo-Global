import { Router, type Request, type Response, type NextFunction } from "express";
import { OrderController } from "../controllers/orderController.js";
import { ApiError, sendProblem } from "../http/errors.js";

const router = Router();

router.get("/orders", OrderController.getAllOrders);

router.get("/orders/:id", OrderController.getOrderById);

router.get("/orders/buyer/:address", OrderController.getOrdersByBuyer);

router.get("/orders/farmer/:address", OrderController.getOrdersByFarmer);
router.get("/orders/seller/:address", OrderController.getOrdersBySeller);

router.get('/stats/:sellerAddress', OrderController.getSellerStats);
export function orderErrorHandler(error: unknown, req: Request, res: Response, next: NextFunction): void {
  if (error instanceof ApiError) {
    sendProblem(res, req, error);
    return;
  }
  next(error);
}

export default router;
