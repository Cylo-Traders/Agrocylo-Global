import type { Request, Response } from "express";
import { DisputeService } from "../services/disputeService.js";
import logger from "../config/logger.js";
import { ApiError, sendProblem } from "../http/errors.js";

export class EvidenceController {
  /**
   * POST /disputes/:order_id/evidence
   * Upload evidence for a dispute
   */
  static async uploadEvidence(req: Request, res: Response) {
    const { order_id } = req.params;
    const file = req.file;

    try {
      if (!order_id) {
        throw new ApiError(400, "Bad Request", "Missing order_id");
      }
      if (!file) {
        throw new ApiError(400, "Bad Request", "No file provided");
      }

      // Delegate validation and upload to service
      const result = await DisputeService.provideEvidence(order_id as string, file);

      return res.status(201).json({
        message: "Evidence uploaded successfully",
        evidenceHash: result.evidenceHash,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return sendProblem(res, req, error);
      }
      logger.error(`Error uploading evidence for order ${order_id}:`, error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}
