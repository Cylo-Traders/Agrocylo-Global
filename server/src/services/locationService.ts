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

    if ((data.lat === undefined) !== (data.lng === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'lat and lng must be provided together' });
    } else if (data.lat === 0 && data.lng === 0) {
      ctx.addIssue({ code: 'custom', message: 'Coordinates (0, 0) are not a valid location' });
    }
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
// by extending the base object with the required coordinate pair. The base
// must be partial: extending the full shape required *both* coordinate pairs
// plus city/country/is_public, rejecting every real client payload.
const optionalLocationFields = z.object(locationShape).partial();
const createLocationSchema = optionalLocationFields
  .extend({ lat: locationShape.lat, lng: locationShape.lng })
  .or(
    optionalLocationFields.extend({
      latitude: locationShape.latitude,
      longitude: locationShape.longitude,
    })
  )
  .transform((value, ctx) => {
    const lat = value.lat ?? value.latitude;
    const lng = value.lng ?? value.longitude;
    if (lat === 0 && lng === 0) {
      ctx.addIssue({ code: 'custom', message: 'Coordinates (0, 0) are not a valid location' });
    }
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
  role: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
}).superRefine((v, ctx) => {
  const given = [v.lat, v.lng, v.radius].filter((x) => x !== undefined).length;
  if (given !== 0 && given !== 3) {
    ctx.addIssue({ code: 'custom', message: 'lat, lng and radius must be provided together' });
  }
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
  const { lat, lng, radius, role, page, limit } = parsed.data;
  const skip = (page - 1) * limit;

  const whereClause: any = { is_public: true };
  if (role) {
    whereClause.profile = { role };
  }

  // Use bounding box for initial filtering when proximity search is requested
  // This leverages the composite index (lat, lng, is_public) for efficient pre-filtering
  if (lat !== undefined && lng !== undefined && radius !== undefined) {
    // Calculate bounding box in degrees (approximation)
    // 1 degree latitude ≈ 111 km; longitude varies by latitude
    const latDelta = radius / 111;
    const lngDelta = radius / (111 * Math.cos((lat * Math.PI) / 180));
    
    whereClause.lat = { gte: lat - latDelta, lte: lat + latDelta };
    whereClause.lng = { gte: lng - lngDelta, lte: lng + lngDelta };
  }

  let locations = await prisma.location.findMany({
    where: whereClause,
    include: { profile: { select: { name: true, role: true, avatar_url: true, bio: true } } },
  });

  // Apply precise haversine filtering for locations within bounding box
  if (lat !== undefined && lng !== undefined && radius !== undefined) {
    locations = locations.filter((l) => haversine(lat, lng, l.lat, l.lng) <= radius);
  }

  const total = locations.length;
  const farmers = locations.slice(skip, skip + limit).map((location) => {
    const distance_km = (lat !== undefined && lng !== undefined)
      ? Math.round(haversine(lat, lng, location.lat, location.lng) * 10) / 10
      : null;

    return {
      wallet_address: (location as any).walletAddress ?? (location as any).wallet_address,
      display_name: location.profile?.name ?? 'Farmer',
      bio: location.profile?.bio ?? null,
      avatar_url: location.profile?.avatar_url ?? null,
      latitude: location.lat,
      longitude: location.lng,
      city: location.city ?? null,
      country: location.country ?? null,
      role: location.profile?.role ?? null,
      distance_km,
    };
  });

  return { data: farmers, farmers, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
}

/**
 * Locations are keyed by the canonical (lower-cased) wallet address, matching
 * the profiles row they reference — canonicalizing here keeps onboarding's
 * location save from violating the profiles FK with a checksummed address
 * (#1185).
 */
function canonicalWallet(walletAddress: string): string {
  return walletAddress.trim().toLowerCase();
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
  const canonical = canonicalWallet(walletAddress);
  return prisma.location.upsert({
    where: { walletAddress: canonical },
    create: { walletAddress: canonical, ...parsed.data },
    update: parsed.data,
  });
}

export async function getLocationByWallet(walletAddress: string) {
  const location = await prisma.location.findUnique({
    where: { walletAddress: canonicalWallet(walletAddress) },
  });
  if (!location)
    throw new ApiError(
      404,
      'Not Found',
      'No saved location for this wallet',
      'https://cylos.io/errors/not-found'
    );
  return location;
}

export async function updateLocation(wallet_address: string, requester: string, body: unknown) {
  const target = canonicalWallet(wallet_address);
  if (canonicalWallet(requester) !== target)
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
  return prisma.location.update({ where: { walletAddress: target }, data: parsed.data });
}

export async function deleteLocation(wallet_address: string, requester: string) {
  const target = canonicalWallet(wallet_address);
  if (canonicalWallet(requester) !== target)
    throw new ApiError(
      403,
      'Forbidden',
      'You can only delete your own location',
      'https://cylos.io/errors/forbidden'
    );
  await prisma.location.delete({ where: { walletAddress: target } });
}
