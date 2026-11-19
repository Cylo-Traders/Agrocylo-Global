# PostGIS Setup Guide

## Overview

This document describes the optional PostGIS extension setup for enhanced geospatial query performance. The current implementation uses a composite B-tree index on `(latitude, longitude, is_public)` which provides good performance for bounding-box queries at moderate scale.

## Current Implementation (Bounding Box + Haversine)

The location service currently:
1. Uses a composite B-tree index to pre-filter locations within a bounding box
2. Applies precise haversine distance calculation in-memory for final filtering
3. Works with standard PostgreSQL (no extensions required)

This approach scales well to thousands of locations and provides acceptable performance for most use cases.

## When to Upgrade to PostGIS

Consider upgrading to PostGIS when:
- You have **> 100,000 locations** in the database
- Query latency for proximity searches exceeds acceptable thresholds
- You need advanced geospatial operations (polygon intersections, complex geometries, etc.)

## PostGIS Migration Steps

### 1. Enable PostGIS Extension

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

### 2. Add Geography Column

```sql
-- Add geography column to locations table
ALTER TABLE locations 
  ADD COLUMN geography geography(Point, 4326);

-- Populate from existing lat/lng columns
UPDATE locations 
  SET geography = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography;

-- Add NOT NULL constraint after backfill
ALTER TABLE locations 
  ALTER COLUMN geography SET NOT NULL;
```

### 3. Create GIST Index

```sql
-- Drop the existing composite index (if transitioning fully to PostGIS)
-- DROP INDEX IF EXISTS "locations_lat_lng_is_public_idx";

-- Create GIST spatial index
CREATE INDEX locations_geography_gist 
  ON locations 
  USING GIST (geography)
  WHERE is_public = true;
```

### 4. Update Application Code

Modify `server/src/services/locationService.ts` to use PostGIS queries:

```typescript
// Replace bounding box filtering with native PostGIS query
const locations = await prisma.$queryRaw<Location[]>`
  SELECT l.*, 
         ST_Distance(geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) as distance
  FROM locations l
  WHERE is_public = true
    AND ST_DWithin(
      geography, 
      ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
      ${radius * 1000}  -- radius in meters
    )
  ORDER BY distance
  LIMIT ${limit} OFFSET ${skip}
`;
```

### 5. Update Prisma Schema

Add the geography field to the schema:

```prisma
model Location {
  walletAddress String     @id @map("wallet_address")
  lat           Float      @map("latitude")
  lng           Float      @map("longitude")
  geography     Unsupported("geography(Point, 4326)")?
  city          String?
  country       String?
  is_public     Boolean    @default(true)
  profile       Profile?   @relation(fields: [walletAddress], references: [walletAddress])

  @@index([lat, lng, is_public])
  @@map("locations")
}
```

## Performance Comparison

| Implementation | Dataset Size | Query Time | Index Type |
|---------------|--------------|------------|------------|
| B-tree + Haversine | < 10,000 | ~50ms | Composite B-tree |
| B-tree + Haversine | 10,000 - 100,000 | ~200ms | Composite B-tree |
| PostGIS GIST | 100,000+ | ~10-50ms | GIST spatial |

## References

- [PostGIS Documentation](https://postgis.net/documentation/)
- [PostgreSQL GIST Indexes](https://www.postgresql.org/docs/current/gist-intro.html)
- [Prisma with PostGIS](https://www.prisma.io/docs/orm/prisma-schema/data-model/unsupported-database-features)

## Testing

To verify index usage:

```sql
EXPLAIN ANALYZE
SELECT * FROM locations
WHERE is_public = true
  AND latitude BETWEEN -10 AND 10
  AND longitude BETWEEN -10 AND 10;
```

Expected output should show `Index Scan` using the composite index.
