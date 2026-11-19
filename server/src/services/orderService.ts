import { prisma } from '../config/database.js';
import { ApiError, NotFoundError } from '../http/errors.js';
import logger from '../config/logger.js';
import { toClientProfile, toClientRole } from '../lib/profileDto.js';
import { OrderStatus } from '../constants/status.js';

const ORDER_INCLUDE = {
  product: true,
  buyerUser: true,
  sellerUser: true,
} as const;

const ORDER_BY_CREATED_DESC = { createdAt: 'desc' } as const;

/**
 * Orders store buyer/seller addresses canonically lower-cased (ingestion +
 * migration normalize them), while callers pass checksummed wallet addresses.
 * Every lookup goes through this helper so queries match regardless of the
 * caller's casing (#1184).
 */
function canonicalWallet(walletAddress: string): string {
  return walletAddress.trim().toLowerCase();
}

export class OrderService {
  static async getAll() {
    try {
      return await prisma.order.findMany({
        include: ORDER_INCLUDE,
        orderBy: ORDER_BY_CREATED_DESC,
      });
    } catch (error) {
      logger.error('Failed to fetch orders', { error });
      throw new ApiError(500, 'Internal Server Error', 'Failed to fetch orders');
    }
  }

  static async getAllForWallet(walletAddress: string) {
    const canonical = canonicalWallet(walletAddress);
    try {
      return await prisma.order.findMany({
        where: {
          OR: [{ buyerAddress: canonical }, { sellerAddress: canonical }],
        },
        include: ORDER_INCLUDE,
        orderBy: ORDER_BY_CREATED_DESC,
      });
    } catch (error) {
      logger.error('Failed to fetch orders for wallet', { error, walletAddress });
      throw new ApiError(500, 'Internal Server Error', 'Failed to fetch orders');
    }
  }

  static async getByOrderId(orderIdOnChain: string) {
    try {
      const order = await prisma.order.findUnique({
        where: { orderIdOnChain },
        include: ORDER_INCLUDE,
      });
      return order;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Failed to fetch order by ID', { error, orderIdOnChain });
      throw new ApiError(500, 'Internal Server Error', 'Failed to fetch order');
    }
  }

  static async getByBuyerAddress(buyerAddress: string) {
    try {
      return await prisma.order.findMany({
        where: { buyerAddress: canonicalWallet(buyerAddress) },
        include: ORDER_INCLUDE,
        orderBy: ORDER_BY_CREATED_DESC,
      });
    } catch (error) {
      logger.error('Failed to fetch orders by buyer', { error, buyerAddress });
      throw new ApiError(500, 'Internal Server Error', 'Failed to fetch buyer orders');
    }
  }

  static async getByFarmerAddress(sellerAddress: string) {
    try {
      return await prisma.order.findMany({
        where: { sellerAddress: canonicalWallet(sellerAddress) },
        include: ORDER_INCLUDE,
        orderBy: ORDER_BY_CREATED_DESC,
      });
    } catch (error) {
      logger.error('Failed to fetch orders by farmer', { error, sellerAddress });
      throw new ApiError(500, 'Internal Server Error', 'Failed to fetch farmer orders');
    }
  }

  static async getSellerStats(sellerAddress: string) {
    const canonical = canonicalWallet(sellerAddress);
    try {
      const [totalOrders, completedCount, refundedCount, disputedCount] = await Promise.all([
        prisma.order.count({ where: { sellerAddress: canonical } }),
        prisma.order.count({ where: { sellerAddress: canonical, status: OrderStatus.COMPLETED } }),
        prisma.order.count({ where: { sellerAddress: canonical, status: OrderStatus.REFUNDED } }),
        prisma.dispute.count({
          where: {
            order: { sellerAddress: canonical },
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
    } catch (error) {
      logger.error('Failed to fetch seller stats', { error, sellerAddress });
      throw new ApiError(500, 'Internal Server Error', 'Failed to fetch seller statistics');
    }
  }

  static async getGraphOrder(orderIdOnChain: string) {
    try {
      const order = await prisma.order.findUnique({
        where: { orderIdOnChain },
        include: {
          product: {
            include: {
              farmer: true,
              priceHistory: {
                orderBy: { timestamp: 'desc' },
              },
            },
          },
          buyerUser: true,
          sellerUser: true,
        },
      });

      if (!order) {
        throw new NotFoundError('Order', orderIdOnChain);
      }

      const [buyerProfile, sellerProfile] = await Promise.all([
        prisma.profile.findUnique({ where: { walletAddress: order.buyerAddress! } }),
        prisma.profile.findUnique({ where: { walletAddress: order.sellerAddress! } }),
      ]);

      return {
        ...order,
        buyer: buyerProfile
          ? toClientProfile(buyerProfile)
          : {
              wallet_address: order.buyerAddress ?? '',
              role: toClientRole((order.buyerUser as any)?.role ?? 'BUYER'),
              display_name: order.buyerAddress ?? '',
              bio: null,
              avatar_url: null,
            },
        seller: sellerProfile
          ? toClientProfile(sellerProfile)
          : {
              wallet_address: order.sellerAddress ?? '',
              role: toClientRole((order.sellerUser as any)?.role ?? 'BUYER'),
              display_name: order.sellerAddress ?? '',
              bio: null,
              avatar_url: null,
            },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Failed to fetch graph order', { error, orderIdOnChain });
      throw new ApiError(500, 'Internal Server Error', 'Failed to fetch order');
    }
  }
}
