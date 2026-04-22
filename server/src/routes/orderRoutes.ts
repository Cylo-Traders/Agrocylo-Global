import { Router } from "express";
import { OrderController } from "../controllers/orderController.js";

const router = Router();

router.get("/orders", OrderController.getAllOrders);

router.get("/orders/:id", OrderController.getOrderById);

router.get("/orders/buyer/:address", OrderController.getOrdersByBuyer);

router.get("/orders/farmer/:address", OrderController.getOrdersByFarmer);
router.get("/orders/seller/:address", OrderController.getOrdersBySeller);

export default router;
