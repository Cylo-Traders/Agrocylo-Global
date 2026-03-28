import { Router } from "express";
import { DisputeController } from "../controllers/disputeController.js";

const router = Router();

/**
 * @route GET /disputes
 * @desc Retrieve all disputes
 */
router.get("/", DisputeController.getAllDisputes);

/**
 * @route GET /disputes/:order_id
 * @desc Retrieve a single dispute by its on-chain order ID
 */
router.get("/:order_id", DisputeController.getDisputeByOrderId);

export default router;
