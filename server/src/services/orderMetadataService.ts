import prisma from '../config/database.js';
import { ApiError } from '../http/errors.js';
import { z } from 'zod';

const createSchema = z.object({
  on_chain_order_id: z.string().min(1),
  description: z.string().min(1),
  farmer_address: z.string().min(1),
  buyer_address: z.string().min(1),
});

export async function createOrderMetadata(body: unknown) {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, 'Bad Request', parsed.error.message, 'https://cylos.io/errors/validation');
  return prisma.orderMetadata.create({ data: parsed.data });
}

export async function getOrderMetadata(on_chain_order_id: string, requester: string) {
  const metadata = await prisma.orderMetadata.findUnique({ where: { on_chain_order_id } });
  if (!metadata) throw new ApiError(404, 'Not Found', 'Order metadata not found', 'https://cylos.io/errors/not-found');
  if (requester !== metadata.farmer_address && requester !== metadata.buyer_address) {
    throw new ApiError(403, 'Forbidden', 'Only buyer or farmer can access this order', 'https://cylos.io/errors/forbidden');
  }
  return metadata;
}
