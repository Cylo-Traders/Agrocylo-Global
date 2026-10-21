import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const REQUIRED_IN_PRODUCTION = [
  'DATABASE_URL',
  'RPC_URL',
  'PRODUCTION_CONTRACT_ID',
  'ESCROW_CONTRACT_ID',
  'JWT_SECRET',
  'METRICS_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

const DEV_JWT_SECRET = 'dev-secret-change-me';

function getEnv(key: string): string | undefined {
  const value = process.env[key];
  return value === undefined || value === '' ? undefined : value;
}

function validateJwtSecret(value: string | undefined): string {
  if (process.env.NODE_ENV !== 'production') {
    return value ?? DEV_JWT_SECRET;
  }
  if (!value) {
    throw new Error('JWT_SECRET is required in production');
  }
  if (value === DEV_JWT_SECRET) {
    throw new Error('JWT_SECRET must not use the development default in production');
  }
  if (value.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }
  return value;
}

function validateMetricsApiKey(value: string | undefined): string {
  if (process.env.NODE_ENV === 'production' && !value) {
    throw new Error('METRICS_API_KEY must be non-empty in production');
  }
  return value ?? '';
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().default('debug'),
  DATABASE_URL: z.string().default(''),
  RPC_URL: z.string().url().default('https://soroban-testnet.stellar.org'),
  PRODUCTION_CONTRACT_ID: z.string().default(''),
  ESCROW_CONTRACT_ID: z.string().default(''),
  PRODUCTION_ESCROW_CONTRACT_ID: z.string().optional(),
  REGISTRY_CONTRACT_ID: z.string().default(''),
  BASKET_CONTRACT_ID: z.string().default(''),
  SUPABASE_URL: z.string().default(''),
  SUPABASE_ANON_KEY: z.string().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
  SUPABASE_CAMPAIGN_IMAGES_BUCKET: z.string().default('campaign-images'),
  CAMPAIGN_IMAGE_PLACEHOLDER_URL: z
    .string()
    .default('https://placehold.co/800x800/png?text=No+Image'),
  JWT_SECRET: z.string().optional(),
  METRICS_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().default(''),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().default(0.1),
  CORS_ORIGINS: z.string().default(''),
  REDIS_URL: z.string().default(''),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  RATE_LIMIT_WRITE_MAX_REQUESTS: z.coerce.number().default(10),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().default(15000),
  RUN_RECONCILIATION_SWEEP: z.string().optional(),
  RECONCILIATION_SWEEP_INTERVAL_MS: z.coerce.number().default(300000),
});

const parsed = envSchema.parse(process.env);

if (parsed.NODE_ENV === 'production') {
  const missing = REQUIRED_IN_PRODUCTION.filter((key) => !getEnv(key));
  if (missing.length > 0) {
    throw new Error(
      `Missing required production environment variables: ${missing.join(', ')}`,
    );
  }
}

const jwtSecret = validateJwtSecret(parsed.JWT_SECRET);
const metricsApiKey = validateMetricsApiKey(parsed.METRICS_API_KEY);

export const config = {
  nodeEnv: parsed.NODE_ENV,
  port: parsed.PORT,
  logLevel: parsed.LOG_LEVEL,
  databaseUrl: parsed.DATABASE_URL,
  rpcUrl: parsed.RPC_URL,
  productionContractId: parsed.PRODUCTION_CONTRACT_ID,
  /** Production contract the event watcher and indexer follow. */
  contractId: parsed.PRODUCTION_CONTRACT_ID,
  escrowContractId: parsed.ESCROW_CONTRACT_ID,
  productionEscrowContractId:
    parsed.PRODUCTION_ESCROW_CONTRACT_ID || parsed.PRODUCTION_CONTRACT_ID,
  registryContractId: parsed.REGISTRY_CONTRACT_ID,
  basketContractId: parsed.BASKET_CONTRACT_ID,
  supabaseUrl: parsed.SUPABASE_URL,
  supabaseAnonKey: parsed.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
  campaignImagesBucket: parsed.SUPABASE_CAMPAIGN_IMAGES_BUCKET,
  campaignImagePlaceholderUrl: parsed.CAMPAIGN_IMAGE_PLACEHOLDER_URL,
  jwtSecret,
  metricsApiKey,
  sentryDsn: parsed.SENTRY_DSN,
  sentryTracesSampleRate: parsed.SENTRY_TRACES_SAMPLE_RATE,
  corsOrigins: parsed.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  redisUrl: parsed.REDIS_URL,
  rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
  rateLimitMaxRequests: parsed.RATE_LIMIT_MAX_REQUESTS,
  rateLimitWriteMaxRequests: parsed.RATE_LIMIT_WRITE_MAX_REQUESTS,
  shutdownTimeoutMs: parsed.SHUTDOWN_TIMEOUT_MS,
  runReconciliationSweep: parsed.RUN_RECONCILIATION_SWEEP !== 'false',
  reconciliationSweepIntervalMs: parsed.RECONCILIATION_SWEEP_INTERVAL_MS,
};

export type Config = typeof config;
