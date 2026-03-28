import { Router } from "express";
import multer from "multer";
import { DisputeController } from "../controllers/disputeController.js";
import { EvidenceController } from "../controllers/evidenceController.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

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

/**
 * @route POST /disputes/:order_id/evidence
 * @desc Upload evidence for a dispute
 */
router.post("/:order_id/evidence", upload.single("file"), EvidenceController.uploadEvidence);

export default router;
