import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const REQUIRED_IN_PRODUCTION = [
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

function validateJwtSecret(value: string | undefined): string | undefined {
  if (process.env.NODE_ENV !== 'production') {
    return value;
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
  RPC_URL: z.string().url().optional(),
  PRODUCTION_CONTRACT_ID: z.string().optional(),
  ESCROW_CONTRACT_ID: z.string().optional(),
  BASKET_CONTRACT_ID: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  METRICS_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  CORS_ORIGINS: z.string().optional(),
  REDIS_URL: z.string().optional(),
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
  rpcUrl: parsed.RPC_URL,
  productionContractId: parsed.PRODUCTION_CONTRACT_ID,
  escrowContractId: parsed.ESCROW_CONTRACT_ID,
  basketContractId: parsed.BASKET_CONTRACT_ID,
  supabaseUrl: parsed.SUPABASE_URL,
  supabaseAnonKey: parsed.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
  jwtSecret,
  metricsApiKey,
  sentryDsn: parsed.SENTRY_DSN,
  corsOrigins: parsed.CORS_ORIGINS,
  redisUrl: parsed.REDIS_URL,
};

export type Config = typeof config;
