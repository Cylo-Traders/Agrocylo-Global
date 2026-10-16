-- Issue 1142: Add geospatial and query indexes
-- Issue 1141: Add version field for optimistic locking

-- Add version field for GroupOrder optimistic locking
ALTER TABLE "GroupOrder" ADD COLUMN IF NOT EXISTS "version" INTEGER DEFAULT 0 NOT NULL;

-- Add composite index for product queries
CREATE INDEX IF NOT EXISTS "idx_product_category_available_created" 
  ON "Product"("category", "is_available", "created_at" DESC);

-- Add index for farmer products
CREATE INDEX IF NOT EXISTS "idx_product_farmer_wallet" 
  ON "Product"("farmer_wallet");

-- Add spatial index for location queries (bounding box approach)
CREATE INDEX IF NOT EXISTS "idx_location_lat_lon" 
  ON "Location"("latitude", "longitude");

-- If PostGIS is available (optional enhancement):
-- CREATE EXTENSION IF NOT EXISTS postgis;
-- ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS geog geography(Point, 4326);
-- UPDATE "Location" SET geog = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326);
-- CREATE INDEX idx_location_geog ON "Location" USING GIST(geog);

COMMENT ON INDEX "idx_product_category_available_created" IS 'Composite index for product listing queries';
COMMENT ON INDEX "idx_product_farmer_wallet" IS 'Index for farmer product lookup';
COMMENT ON INDEX "idx_location_lat_lon" IS 'Spatial index for proximity queries';
