-- Add geospatial and query indexes for location and product listing queries (Issue #1142)

-- Index 1: Composite index for location proximity queries
-- Query pattern: SELECT * FROM locations WHERE is_public = true AND latitude BETWEEN ... AND longitude BETWEEN ...
-- This composite index supports bounding-box queries for proximity searches.
-- For production PostGIS usage, consider: CREATE INDEX IF NOT EXISTS idx_locations_geography_gist ON locations USING GIST (geography(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)));
CREATE INDEX IF NOT EXISTS "locations_lat_lng_is_public_idx"
  ON "locations" ("latitude", "longitude", "is_public")
  WHERE "is_public" = true;

-- Index 2: Product category + availability + recency for filtered listings
-- Query pattern: SELECT * FROM products WHERE category = $1 AND is_available = true ORDER BY created_at DESC
-- This composite index covers category filtering with availability and temporal sorting.
CREATE INDEX IF NOT EXISTS "products_category_isAvailable_createdAt_idx"
  ON "products" ("category", "is_available", "created_at" DESC);

-- Index 3: Product availability + recency for general listings
-- Query pattern: SELECT * FROM products WHERE is_available = true ORDER BY created_at DESC LIMIT N OFFSET M
-- This composite index covers availability filtering with temporal sorting for pagination.
CREATE INDEX IF NOT EXISTS "products_isAvailable_createdAt_idx"
  ON "products" ("is_available", "created_at" DESC);

-- Index 4: Farmer-scoped product listings with recency
-- Query pattern: SELECT * FROM products WHERE farmer_wallet = $1 ORDER BY created_at DESC
-- This composite index covers farmer-specific queries with temporal sorting.
CREATE INDEX IF NOT EXISTS "products_farmerWallet_createdAt_idx"
  ON "products" ("farmer_wallet", "created_at" DESC);
