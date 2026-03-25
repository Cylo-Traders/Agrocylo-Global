import prisma from '../config/database.js';
import { ApiError } from '../http/errors.js';
import { z } from 'zod';

const setLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  is_public: z.boolean().default(true),
});

const proximitySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function getFarmerLocations(query: unknown) {
  const parsed = proximitySchema.safeParse(query);
  if (!parsed.success) throw new ApiError(400, 'Bad Request', parsed.error.message, 'https://cylos.io/errors/validation');
  const { lat, lng, radius, page, limit } = parsed.data;
  const skip = (page - 1) * limit;
  let locations = await prisma.location.findMany({
    where: { is_public: true },
    include: { profile: { select: { name: true, role: true, avatar_url: true } } },
  });
  if (lat !== undefined && lng !== undefined && radius !== undefined) {
    locations = locations.filter((l) => haversine(lat, lng, l.lat, l.lng) <= radius);
  }
  const total = locations.length;
  return { data: locations.slice(skip, skip + limit), meta: { total, page, limit, pages: Math.ceil(total / limit) } };
}

export async function setLocation(walletAddress: string, body: unknown) {
  const parsed = setLocationSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, 'Bad Request', parsed.error.message, 'https://cylos.io/errors/validation');
  return prisma.location.upsert({
    where: { wallet_address: walletAddress },
    create: { wallet_address: walletAddress, ...parsed.data },
    update: parsed.data,
  });
}

export async function updateLocation(wallet_address: string, requester: string, body: unknown) {
  if (requester !== wallet_address) throw new ApiError(403, 'Forbidden', 'You can only update your own location', 'https://cylos.io/errors/forbidden');
  const parsed = setLocationSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, 'Bad Request', parsed.error.message, 'https://cylos.io/errors/validation');
  return prisma.location.update({ where: { wallet_address }, data: parsed.data });
}

export async function deleteLocation(wallet_address: string, requester: string) {
  if (requester !== wallet_address) throw new ApiError(403, 'Forbidden', 'You can only delete your own location', 'https://cylos.io/errors/forbidden');
  await prisma.location.delete({ where: { wallet_address } });
}
