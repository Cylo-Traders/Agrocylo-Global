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
}

