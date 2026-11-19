import type { Request, Response } from 'express';
import { DisputeService } from '../services/disputeService.js';
import logger from '../config/logger.js';
import type { WalletRequest } from '../middleware/walletAuth.js';

export class DisputeController {
  /**
   * GET /disputes
   * Retrieve disputes scoped to the authenticated wallet
   */
  static async getAllDisputes(req: Request, res: Response) {
    try {
      const walletReq = req as WalletRequest;
      const walletAddress = walletReq.walletAddress;
      if (!walletAddress) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const disputes = await DisputeService.getAllDisputesForWallet(walletAddress);
      return res.status(200).json(disputes);
    } catch (error) {
      logger.error('Error fetching all disputes:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /disputes/:order_id
   * Retrieve a single dispute by its on-chain order ID (scoped to wallet)
   */
  static async getDisputeByOrderId(req: Request, res: Response) {
    const { order_id } = req.params;
    try {
      const walletReq = req as WalletRequest;
      const walletAddress = walletReq.walletAddress;
      if (!walletAddress) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const dispute = await DisputeService.getDisputeByOrderId(order_id as string);

      if (!dispute) {
        return res.status(404).json({ error: 'Dispute not found' });
      }

      if (
        dispute.order.buyerAddress !== walletAddress &&
        dispute.order.sellerAddress !== walletAddress
      ) {
        return res.status(403).json({ error: 'Forbidden: you do not have access to this dispute' });
      }

      return res.status(200).json(dispute);
    } catch (error) {
      logger.error(`Error fetching dispute for order ${order_id}:`, error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}
