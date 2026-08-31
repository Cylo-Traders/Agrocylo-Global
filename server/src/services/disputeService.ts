import { prisma } from "../config/database.js";
import { EvidenceStorageService } from "./evidenceStorageService.js";
import { ApiError, NotFoundError } from "../http/errors.js";
import logger from "../config/logger.js";
import { DisputeStatus } from "../constants/status.js";

export class DisputeService {
  /**
   * Fetch all disputes with full order and product metadata
   */
  static async getAllDisputes() {
    try {
      return await prisma.dispute.findMany({
        include: {
          order: {
            include: {
              product: true,
              buyerUser: true,
              sellerUser: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    } catch (error) {
      logger.error("Failed to fetch disputes", { error });
      throw new ApiError(500, "Internal Server Error", "Failed to fetch disputes");
    }
  }

  /**
   * Fetch disputes scoped to a specific wallet (buyer or seller)
   */
  static async getAllDisputesForWallet(walletAddress: string) {
    try {
      return await prisma.dispute.findMany({
        where: {
          OR: [
            { order: { buyerAddress: walletAddress } },
            { order: { sellerAddress: walletAddress } },
          ],
        },
        include: {
          order: {
            include: {
              product: true,
              buyerUser: true,
              sellerUser: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    } catch (error) {
      logger.error("Failed to fetch disputes for wallet", { error, walletAddress });
      throw new ApiError(500, "Internal Server Error", "Failed to fetch disputes");
    }
  }

  /**
   * Fetch a single dispute by its on-chain order ID
   */
  static async getDisputeByOrderId(orderIdOnChain: string) {
    try {
      const dispute = await prisma.dispute.findUnique({
        where: { orderIdOnChain },
        include: {
          order: {
            include: {
              product: true,
              buyerUser: true,
              sellerUser: true,
            },
          },
        },
      });
      if (!dispute) {
        throw new NotFoundError("Dispute", orderIdOnChain);
      }
      return dispute;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error("Failed to fetch dispute by order ID", { error, orderIdOnChain });
      throw new ApiError(500, "Internal Server Error", "Failed to fetch dispute");
    }
  }

  /**
   * Attach evidence hash to a dispute
   */
  static async attachEvidence(orderIdOnChain: string, evidenceHash: string) {
    try {
      return await prisma.dispute.update({
        where: { orderIdOnChain },
        data: { evidenceHash },
      });
    } catch (error) {
      logger.error("Failed to attach evidence to dispute", { error, orderIdOnChain });
      throw new ApiError(500, "Internal Server Error", "Failed to attach evidence");
    }
  }

  /**
   * Orchestrate evidence upload and attachment with validation
   */
  static async provideEvidence(orderIdOnChain: string, file: Express.Multer.File, walletAddress: string) {
    const dispute = await this.getDisputeByOrderId(orderIdOnChain);

    const isParticipant =
      dispute.order.buyerAddress === walletAddress || dispute.order.sellerAddress === walletAddress;

    if (!isParticipant) {
      throw new ApiError(403, "Forbidden", "Only dispute participants can submit evidence");
    }

    if (dispute.status === DisputeStatus.RESOLVED || dispute.status === DisputeStatus.DISMISSED) {
      throw new ApiError(409, "Conflict", `Cannot submit evidence to a ${dispute.status.toLowerCase()} dispute`);
    }

    const evidenceHash = await EvidenceStorageService.uploadEvidence(file, orderIdOnChain);

    return this.attachEvidence(orderIdOnChain, evidenceHash);
  }
}
