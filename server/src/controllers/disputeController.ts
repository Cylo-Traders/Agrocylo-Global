import type { Request, Response } from "express";
import { DisputeService } from "../services/disputeService.js";
import logger from "../config/logger.js";

export class DisputeController {
  /**
   * GET /disputes
   * Retrieve all disputes with order metadata
   */
  static async getAllDisputes(req: Request, res: Response) {
    try {
      const disputes = await DisputeService.getAllDisputes();
      return res.status(200).json(disputes);
    } catch (error) {
      logger.error("Error fetching all disputes:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * GET /disputes/:order_id
   * Retrieve a single dispute by its on-chain order ID
   */
  static async getDisputeByOrderId(req: Request, res: Response) {
    const { order_id } = req.params ;
    try {
      const dispute = await DisputeService.getDisputeByOrderId(order_id as string);

      if (!dispute) {
        return res.status(404).json({ error: "Dispute not found" });
      }

      return res.status(200).json(dispute);
    } catch (error) {
      logger.error(`Error fetching dispute for order ${order_id}:`, error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}
