import { prisma } from '../config/database.js';
import { ApiError } from '../http/errors.js';
import { z } from 'zod';

const createSchema = z.object({
  on_chain_order_id: z.string().min(1),
  description: z.string().min(1),
});

function walletsMatch(a: string, b: string | null | undefined): boolean {
  if (!b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

export async function createOrderMetadata(body: unknown, requester: string) {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      400,
      'Bad Request',
      parsed.error.message,
      'https://cylos.io/errors/validation'
    );
  }

  const { on_chain_order_id, description } = parsed.data;

  const order = await prisma.order.findUnique({
    where: { orderIdOnChain: on_chain_order_id },
  });

  if (!order) {
    throw new ApiError(404, 'Not Found', 'Order not found', 'https://cylos.io/errors/not-found');
  }

  const isParticipant =
    walletsMatch(requester, order.buyerAddress) || walletsMatch(requester, order.sellerAddress);

  if (!isParticipant) {
    throw new ApiError(
      403,
      'Forbidden',
      'Only buyer or farmer can create order metadata',
      'https://cylos.io/errors/forbidden'
    );
  }

  return prisma.orderMetadata.create({
    data: {
      on_chain_order_id,
      description,
      farmer_address: order.sellerAddress ?? '',
      buyer_address: order.buyerAddress ?? '',
    },
  });
}

export async function getOrderMetadata(on_chain_order_id: string, requester: string) {
  const metadata = await prisma.orderMetadata.findUnique({ where: { on_chain_order_id } });
  if (!metadata) {
    throw new ApiError(
      404,
      'Not Found',
      'Order metadata not found',
      'https://cylos.io/errors/not-found'
    );
  }

  const order = await prisma.order.findUnique({
    where: { orderIdOnChain: on_chain_order_id },
  });

  if (order) {
    const isParticipant =
      walletsMatch(requester, order.buyerAddress) || walletsMatch(requester, order.sellerAddress);
    if (!isParticipant) {
      throw new ApiError(
        403,
        'Forbidden',
        'Only buyer or farmer can access this order',
        'https://cylos.io/errors/forbidden'
      );
    }
  } else {
    const isParticipant =
      walletsMatch(requester, metadata.farmer_address) ||
      walletsMatch(requester, metadata.buyer_address);
    if (!isParticipant) {
      throw new ApiError(
        403,
        'Forbidden',
        'Only buyer or farmer can access this order',
        'https://cylos.io/errors/forbidden'
      );
    }
  }

  return metadata;
}
