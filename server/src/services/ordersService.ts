import { prisma } from '../config/database.js';
import { ApiError } from '../http/errors.js';

export type OrderStatusFilter = 'all' | 'active' | 'completed' | 'refunded';

const STATUS_FILTERS: Record<OrderStatusFilter, string[] | undefined> = {
  all: undefined,
  active: ['PENDING'],
  completed: ['COMPLETED'],
  refunded: ['REFUNDED'],
};

export function parseOrderStatusFilter(input: unknown): OrderStatusFilter {
  if (typeof input !== 'string') return 'all';
  const normalized = input.toLowerCase();
  if (
    normalized === 'all' ||
    normalized === 'active' ||
    normalized === 'completed' ||
    normalized === 'refunded'
  ) {
    return normalized;
  }
  throw new ApiError(400, 'Bad Request', 'Invalid status filter', 'https://cylos.io/errors/validation');
}

export async function listBuyerOrders(walletAddress: string, status: OrderStatusFilter) {
  const statuses = STATUS_FILTERS[status];

  const orders = await prisma.order.findMany({
    where: {
      buyerAddress: walletAddress,
      ...(statuses ? { status: { in: statuses } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          unit: true,
          imageUrl: true,
        },
      },
      sellerUser: {
        select: {
          walletAddress: true,
          username: true,
        },
      },
    },
  });

  return {
    items: orders.map((order: (typeof orders)[number]) => ({
      id: order.id,
      order_id: order.orderIdOnChain,
      buyer_address: order.buyerAddress,
      seller_address: order.sellerAddress,
      seller_name: order.sellerUser?.username ?? null,
      amount: order.amount,
      token: order.token,
      status: order.status,
      created_at: order.createdAt.toISOString(),
      updated_at: order.updatedAt.toISOString(),
      product: order.product
        ? {
            id: order.product.id,
            name: order.product.name,
            unit: order.product.unit,
            image_url: order.product.imageUrl,
          }
        : null,
    })),
  };
}
