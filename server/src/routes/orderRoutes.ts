import { Router } from "express";
import { OrderController } from "../controllers/orderController.js";

const router = Router();

/**
 * @route GET /orders
 * @desc Retrieve all orders
 */
router.get("/", OrderController.getAllOrders);

/**
 * @route GET /orders/:id
 * @desc Retrieve a single order by its on-chain ID
 */
router.get("/:id", OrderController.getOrderById);

/**
 * @route GET /orders/buyer/:address
 * @desc Retrieve orders for a specific buyer
 */
router.get("/buyer/:address", OrderController.getOrdersByBuyer);

/**
 * @route GET /orders/seller/:address
 * @desc Retrieve orders for a specific seller
 */
router.get("/seller/:address", OrderController.getOrdersBySeller);

router.get('/stats/:sellerAddress', OrderController.getSellerStats);
export default router;
