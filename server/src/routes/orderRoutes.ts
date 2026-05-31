import { Router, type Request, type Response, type NextFunction } from "express";
import { OrderController } from "../controllers/orderController.js";
import { ApiError, sendProblem } from "../http/errors.js";

const router = Router();

router.get("/", OrderController.getAllOrders);

router.get("/buyer/:address", OrderController.getOrdersByBuyer);

router.get("/seller/:address", OrderController.getOrdersBySeller);

router.get("/stats/:sellerAddress", OrderController.getSellerStats);

router.get("/:id", OrderController.getOrderById);

export function orderErrorHandler(error: unknown, req: Request, res: Response, next: NextFunction): void {
  if (error instanceof ApiError) {
    sendProblem(res, req, error);
    return;
  }
  next(error);
}

export default router;
