import 'dotenv/config';
import { cleanEnv, str, port, bool, url } from 'envalid';

const env = cleanEnv(process.env, {
  NODE_ENV: str({ choices: ['development', 'test', 'production'], default: 'development' }),
  PORT: port({ default: 5000 }),
  DATABASE_URL: str(),
  SUPABASE_URL: url(),
  SUPABASE_ANON_KEY: str(),
  REDIS_URL: str({ default: 'redis://127.0.0.1:6379' }),
  RUN_WORKERS: bool({ default: false }),
  METRICS_API_KEY: str({ default: '' }),
  SUPABASE_SERVICE_ROLE_KEY: str({ default: '' }),
  SUPABASE_PRODUCT_IMAGES_BUCKET: str({ default: 'product-images' }),
  PRODUCT_IMAGE_PLACEHOLDER_URL: str({ default: 'https://placehold.co/800x800/png?text=No+Image' }),
  JWT_SECRET: str({ default: 'changeme' }),
  CONTRACT_ID: str({ default: '' }),
  RPC_URL: str({ default: 'https://soroban-testnet.stellar.org' }),
  WS_PATH: str({ default: '/ws' }),
});

export const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  redisUrl: env.REDIS_URL,
  runWorkers: env.RUN_WORKERS,
  metricsApiKey: env.METRICS_API_KEY,
  supabaseUrl: env.SUPABASE_URL,
  supabaseAnonKey: env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  productImagesBucket: env.SUPABASE_PRODUCT_IMAGES_BUCKET,
  productImagePlaceholderUrl: env.PRODUCT_IMAGE_PLACEHOLDER_URL,
  jwtSecret: env.JWT_SECRET,
  contractId: env.CONTRACT_ID,
  rpcUrl: env.RPC_URL,
  wsPath: env.WS_PATH,
};