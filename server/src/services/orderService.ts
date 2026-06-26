import { prisma } from "../config/database.js";

const ORDER_INCLUDE = {
  product: true,
  buyerUser: true,
  sellerUser: true,
} as const;

const ORDER_BY_CREATED_DESC = { createdAt: "desc" } as const;

export class OrderService {
  static getAll() {
    return prisma.order.findMany({
      include: ORDER_INCLUDE,
      orderBy: ORDER_BY_CREATED_DESC,
    });
  }

  static getByOrderId(orderIdOnChain: string) {
    return prisma.order.findUnique({
      where: { orderIdOnChain },
      include: ORDER_INCLUDE,
    });
  }

  static getByBuyerAddress(buyerAddress: string) {
    return prisma.order.findMany({
      where: { buyerAddress },
      include: ORDER_INCLUDE,
      orderBy: ORDER_BY_CREATED_DESC,
    });
  }

  static getByFarmerAddress(sellerAddress: string) {
    return prisma.order.findMany({
      where: { sellerAddress },
      include: ORDER_INCLUDE,
      orderBy: ORDER_BY_CREATED_DESC,
    });
  }

  static async getSellerStats(sellerAddress: string) {
    const [totalOrders, completedCount, refundedCount, disputedCount] =
      await Promise.all([
        prisma.order.count({ where: { sellerAddress } }),
        prisma.order.count({ where: { sellerAddress, status: "COMPLETED" } }),
        prisma.order.count({ where: { sellerAddress, status: "REFUNDED" } }),
        prisma.dispute.count({
          where: {
            order: { sellerAddress },
          },
        }),
      ]);

    if (totalOrders === 0) {
      return {
        totalOrders: 0,
        successRate: 100,
        disputeRate: 0,
        refundRatio: 0,
      };
    }

    return {
      totalOrders,
      successRate: (completedCount / totalOrders) * 100,
      disputeRate: (disputedCount / totalOrders) * 100,
      refundRatio: (refundedCount / totalOrders) * 100,
    };
  }
}
