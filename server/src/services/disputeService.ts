import { prisma } from "../config/database.js";
import { EvidenceStorageService } from "./evidenceStorageService.js";
import { ApiError } from "../http/errors.js";

export class DisputeService {
  /**
   * Fetch all disputes with full order and product metadata
   */
  static async getAllDisputes() {
    return prisma.dispute.findMany({
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
  }

  /**
   * Fetch a single dispute by its on-chain order ID
   */
  static async getDisputeByOrderId(orderIdOnChain: string) {
    return prisma.dispute.findUnique({
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
  }

  /**
   * Attach evidence hash to a dispute
   */
  static async attachEvidence(orderIdOnChain: string, evidenceHash: string) {
    return prisma.dispute.update({
      where: { orderIdOnChain },
      data: { evidenceHash },
    });
  }

  /**
   * Orchestrate evidence upload and attachment with validation
   */
  static async provideEvidence(orderIdOnChain: string, file: Express.Multer.File) {
    const dispute = await this.getDisputeByOrderId(orderIdOnChain);
    if (!dispute) {
      throw new ApiError(404, "Not Found", `Dispute not found for order ${orderIdOnChain}`);
    }

    const evidenceHash = await EvidenceStorageService.uploadEvidence(file, orderIdOnChain);

    return this.attachEvidence(orderIdOnChain, evidenceHash);
  }
}
