import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { DisputeController } from "../controllers/disputeController.js";
import { EvidenceController } from "../controllers/evidenceController.js";
import { requireWallet } from "../middleware/walletAuth.js";
import { evidenceUpload } from "../middleware/upload.js";

const router = Router();

/**
 * @route GET /disputes
 * @desc Retrieve disputes scoped to the authenticated wallet
 */
router.get("/", requireWallet, DisputeController.getAllDisputes);

/**
 * @route GET /disputes/:order_id
 * @desc Retrieve a single dispute by its on-chain order ID
 */
router.get("/:order_id", requireWallet, DisputeController.getDisputeByOrderId);

/**
 * @route POST /disputes/:order_id/evidence
 * @desc Upload evidence for a dispute (participants only, OPEN disputes only)
 */
router.post("/:order_id/evidence", requireWallet, evidenceUpload.single("file"), EvidenceController.uploadEvidence);

export function disputeUploadErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ message: "Payload Too Large. Max evidence size is 5MB." });
    return;
  }
  next(err);
}

export default router;
