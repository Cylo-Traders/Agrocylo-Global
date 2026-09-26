import { prisma } from '../config/database.js';
import { ApiError } from '../http/errors.js';
import { z } from 'zod';

const locationShape = {
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  city: z.string().trim().max(120).nullable(),
  country: z.string().trim().max(120).nullable(),
  is_public: z.boolean(),
};

const updateLocationSchema = z
  .object(locationShape)
  .partial()
  .transform((value, ctx) => {
    const data: {
      lat?: number;
      lng?: number;
      city?: string | null;
      country?: string | null;
      is_public?: boolean;
    } = {};
    if (value.lat !== undefined) data.lat = value.lat;
    if (value.lng !== undefined) data.lng = value.lng;
    if (value.latitude !== undefined) data.lat = value.latitude;
    if (value.longitude !== undefined) data.lng = value.longitude;
    if (value.city !== undefined) data.city = value.city;
    if (value.country !== undefined) data.country = value.country;
    if (value.is_public !== undefined) data.is_public = value.is_public;

    if (Object.keys(data).length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'At least one field to update must be provided',
      });
    }
    return data;
  });

// `z.object(...).required()` was removed in Zod 4 and never applied to the
// transform pipeline above anyway, so the two accepted create shapes are built
// by extending the base object with the required coordinate pair.
const createLocationSchema = z
  .object(locationShape)
  .extend({ lat: locationShape.lat, lng: locationShape.lng })
  .or(
    z
      .object(locationShape)
      .extend({ latitude: locationShape.latitude, longitude: locationShape.longitude })
  )
  .transform((value) => {
    const lat = value.lat ?? value.latitude;
    const lng = value.lng ?? value.longitude;
    return {
      lat: lat!,
      lng: lng!,
      city: value.city ?? null,
      country: value.country ?? null,
      is_public: value.is_public ?? true,
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
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function getFarmerLocations(query: unknown) {
  const parsed = proximitySchema.safeParse(query);
  if (!parsed.success)
    throw new ApiError(
      400,
      'Bad Request',
      parsed.error.message,
      'https://cylos.io/errors/validation'
    );
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
    wallet_address: (location as any).walletAddress ?? (location as any).wallet_address,
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
  const parsed = createLocationSchema.safeParse(body);
  if (!parsed.success)
    throw new ApiError(
      400,
      'Bad Request',
      parsed.error.message,
      'https://cylos.io/errors/validation'
    );
  return prisma.location.upsert({
    where: { walletAddress },
    create: { walletAddress, ...parsed.data },
    update: parsed.data,
  });
}

export async function updateLocation(wallet_address: string, requester: string, body: unknown) {
  if (requester !== wallet_address)
    throw new ApiError(
      403,
      'Forbidden',
      'You can only update your own location',
      'https://cylos.io/errors/forbidden'
    );
  const parsed = updateLocationSchema.safeParse(body);
  if (!parsed.success)
    throw new ApiError(
      400,
      'Bad Request',
      parsed.error.message,
      'https://cylos.io/errors/validation'
    );
  return prisma.location.update({ where: { walletAddress: wallet_address }, data: parsed.data });
}

export async function deleteLocation(wallet_address: string, requester: string) {
  if (requester !== wallet_address)
    throw new ApiError(
      403,
      'Forbidden',
      'You can only delete your own location',
      'https://cylos.io/errors/forbidden'
    );
  await prisma.location.delete({ where: { walletAddress: wallet_address } });
}
