import 'dotenv/config';

const REQUIRED_IN_PRODUCTION = [
  'RPC_URL',
  'PRODUCTION_CONTRACT_ID',
  'ESCROW_CONTRACT_ID',
] as const;

function getEnv(key: string): string | undefined {
  return process.env[key];
}

function requireEnv(key: string): string {
  const value = getEnv(key);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

const isProduction = (process.env['NODE_ENV'] ?? 'development') === 'production';

if (isProduction) {
  const missing = REQUIRED_IN_PRODUCTION.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `[config] Startup aborted — missing required environment variables in production:\n  ${missing.join('\n  ')}\n` +
      `Set these in your deployment environment before starting the server.`,
    );
  }
}

function parseOriginList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export const config = {
  port: parseInt(getEnv('PORT') ?? '5001', 10),
  nodeEnv: getEnv('NODE_ENV') ?? 'development',
  logLevel: getEnv('LOG_LEVEL') ?? 'debug',

  databaseUrl: requireEnv('DATABASE_URL'),

  rpcUrl: isProduction
    ? requireEnv('RPC_URL')
    : (getEnv('RPC_URL') ?? 'https://soroban-testnet.stellar.org'),

  contractId: isProduction
    ? requireEnv('PRODUCTION_CONTRACT_ID')
    : (getEnv('PRODUCTION_CONTRACT_ID') ?? ''),

  escrowContractId: isProduction
    ? requireEnv('ESCROW_CONTRACT_ID')
    : (getEnv('ESCROW_CONTRACT_ID') ?? ''),

  productionEscrowContractId:
    getEnv('PRODUCTION_ESCROW_CONTRACT_ID') ??
    getEnv('PRODUCTION_CONTRACT_ID') ??
    '',

  rateLimitWindowMs: parseInt(getEnv('RATE_LIMIT_WINDOW_MS') ?? '60000', 10),
  rateLimitMaxRequests: parseInt(getEnv('RATE_LIMIT_MAX_REQUESTS') ?? '100', 10),
  rateLimitWriteMaxRequests: parseInt(getEnv('RATE_LIMIT_WRITE_MAX_REQUESTS') ?? '10', 10),

  redisUrl: getEnv('REDIS_URL') ?? '',

  corsOrigins: parseOriginList(getEnv('CORS_ORIGINS') ?? ''),

  metricsApiKey: getEnv('METRICS_API_KEY') ?? '',

  shutdownTimeoutMs: parseInt(getEnv('SHUTDOWN_TIMEOUT_MS') ?? '15000', 10),

  supabaseUrl: getEnv('SUPABASE_URL') ?? '',
  supabaseAnonKey: getEnv('SUPABASE_ANON_KEY') ?? '',
  supabaseServiceRoleKey: getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  campaignImagesBucket: getEnv('SUPABASE_CAMPAIGN_IMAGES_BUCKET') ?? 'campaign-images',
  campaignImagePlaceholderUrl:
    getEnv('CAMPAIGN_IMAGE_PLACEHOLDER_URL') ??
    'https://placehold.co/800x800/png?text=No+Image',
};
