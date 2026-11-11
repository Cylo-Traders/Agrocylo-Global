import type { Request, Response } from 'express';
import { DisputeService } from '../services/disputeService.js';
import logger from '../config/logger.js';
import { ApiError, sendProblem } from '../http/errors.js';
import type { WalletRequest } from '../middleware/walletAuth.js';

export class EvidenceController {
  /**
   * POST /disputes/:order_id/evidence
   * Upload evidence for a dispute (participants only, OPEN disputes only)
   */
  static async uploadEvidence(req: Request, res: Response) {
    const { order_id } = req.params;
    const file = req.file;
    const walletReq = req as WalletRequest;
    const walletAddress = walletReq.walletAddress;

    try {
      if (!walletAddress) {
        throw new ApiError(401, 'Unauthorized', 'Authentication required');
      }
      if (!order_id) {
        throw new ApiError(400, 'Bad Request', 'Missing order_id');
      }
      if (!file) {
        throw new ApiError(400, 'Bad Request', 'No file provided');
      }

      const result = await DisputeService.provideEvidence(order_id as string, file, walletAddress);

      return res.status(201).json({
        message: 'Evidence uploaded successfully',
        evidenceHash: result.evidenceHash,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return sendProblem(res, req, error);
      }
      logger.error(`Error uploading evidence for order ${order_id}:`, error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}
