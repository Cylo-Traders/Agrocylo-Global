import { prisma } from '../config/database.js';
import { ApiError } from '../http/errors.js';
import { z } from 'zod';

const setLocationSchema = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  city: z.string().trim().max(120).optional().nullable(),
  country: z.string().trim().max(120).optional().nullable(),
  is_public: z.boolean().default(true),
}).transform((value, ctx) => {
  const lat = value.lat ?? value.latitude;
  const lng = value.lng ?? value.longitude;

  if (lat === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['lat'],
      message: 'lat or latitude is required',
    });
  }

  if (lng === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['lng'],
      message: 'lng or longitude is required',
    });
  }

  return {
    lat: lat ?? 0,
    lng: lng ?? 0,
    city: value.city ?? null,
    country: value.country ?? null,
    is_public: value.is_public,
  };
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
    include: { profile: { select: { name: true, role: true, avatar_url: true, bio: true } } },
  });
  if (lat !== undefined && lng !== undefined && radius !== undefined) {
    locations = locations.filter((l) => haversine(lat, lng, l.lat, l.lng) <= radius);
  }
  const total = locations.length;
  const farmers = locations.slice(skip, skip + limit).map((location) => ({
    wallet_address: location.wallet_address,
    display_name: location.profile?.name ?? 'Farmer',
    bio: location.profile?.bio ?? null,
    avatar_url: location.profile?.avatar_url ?? null,
    latitude: location.lat,
    longitude: location.lng,
    city: location.city ?? null,
    country: location.country ?? null,
  }));
  return { data: farmers, farmers, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
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
