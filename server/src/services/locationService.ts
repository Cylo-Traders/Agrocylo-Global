import { query } from '../config/database.js';

export interface FarmerLocationRow {
  wallet_address: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  latitude: number;
  longitude: number;
  city: string | null;
  country: string | null;
  distance_km: number | null;
}

/**
 * Fetch public farmer locations, optionally filtered by proximity.
 *
 * When lat/lng/radius are provided, uses the `farmers_within_radius` SQL
 * function (PostGIS). Otherwise returns all public farmer locations.
 */
export async function getFarmerLocations(
  lat?: number,
  lng?: number,
  radiusKm?: number,
): Promise<FarmerLocationRow[]> {
  if (lat != null && lng != null && radiusKm != null && radiusKm > 0) {
    const radiusMeters = radiusKm * 1000;
    const result = await query<FarmerLocationRow>(
      `SELECT * FROM farmers_within_radius($1, $2, $3)`,
      [lat, lng, radiusMeters],
    );
    return result.rows;
  }

  // No proximity filter — return all public farmer locations
  const result = await query<FarmerLocationRow>(
    `SELECT
       p.wallet_address,
       p.display_name,
       p.bio,
       p.avatar_url,
       l.latitude,
       l.longitude,
       l.city,
       l.country,
       NULL as distance_km
     FROM locations l
     JOIN profiles p ON p.wallet_address = l.wallet_address
     WHERE l.is_public = true AND p.role = 'farmer'
     ORDER BY p.display_name`,
  );
  return result.rows;
}
