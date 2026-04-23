import 'dotenv/config';
import logger from './logger.js';

const requiredEnvs = ['PORT', 'NODE_ENV'];
requiredEnvs.forEach((key) => {
  if (!process.env[key]) {
    logger.warn(`Environment variable ${key} is missing. Using default.`);
  }
});

export const config = {
  port: process.env['PORT'] ?? 5000,
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  redisUrl: process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379",
  runWorkers: (process.env["RUN_WORKERS"] ?? "").toLowerCase() === "true",
  supabaseUrl: process.env['SUPABASE_URL'] ?? '',
  supabaseAnonKey: process.env['SUPABASE_ANON_KEY'] ?? '',
  supabaseServiceRoleKey: process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '',
  productImagesBucket: process.env['SUPABASE_PRODUCT_IMAGES_BUCKET'] ?? 'product-images',
  productImagePlaceholderUrl:
    process.env['PRODUCT_IMAGE_PLACEHOLDER_URL'] ?? 'https://placehold.co/800x800/png?text=No+Image',
};