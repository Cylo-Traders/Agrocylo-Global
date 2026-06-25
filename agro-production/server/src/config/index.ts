import 'dotenv/config';

const ENV_HELP_PATH = 'agro-production/.env.example';

const REQUIRED_IN_PRODUCTION = [
  {
    key: 'DATABASE_URL',
    description: 'PostgreSQL connection string used by Prisma and the API server',
    clientKey: undefined,
  },
  {
    key: 'RPC_URL',
    description: 'Soroban RPC endpoint for server-side watchers and contract calls',
    clientKey: 'NEXT_PUBLIC_SOROBAN_RPC_URL',
  },
  {
    key: 'PRODUCTION_CONTRACT_ID',
    description: 'Production escrow contract ID used by server watchers',
    clientKey: 'NEXT_PUBLIC_PRODUCTION_CONTRACT_ID',
  },
  {
    key: 'ESCROW_CONTRACT_ID',
    description: 'Escrow contract ID used by server-side escrow services',
    clientKey: undefined,
  },
] as const;

type RequiredEnvKey = (typeof REQUIRED_IN_PRODUCTION)[number]['key'];

function getEnv(key: string): string | undefined {
  return process.env[key];
}

function formatMissingEnvError(keys: readonly RequiredEnvKey[]): string {
  const details = keys
    .map((key) => {
      const meta = REQUIRED_IN_PRODUCTION.find((entry) => entry.key === key);
      const clientHint = meta?.clientKey ? ` Mirror to ${meta.clientKey} for the Next.js client.` : '';
      return `  - ${key}: ${meta?.description ?? 'Required runtime setting'}.${clientHint}`;
    })
    .join('\n');

  return [
    '[config] Startup aborted — missing required environment variables:',
    details,
    `Copy ${ENV_HELP_PATH}, replace every REPLACE_WITH_* placeholder, and set these values before starting the server.`,
  ].join('\n');
}

function requireEnv(key: RequiredEnvKey): string {
  const value = getEnv(key);
  if (!value) {
    throw new Error(formatMissingEnvError([key]));
  }
  return value;
}

const isProduction = (process.env['NODE_ENV'] ?? 'development') === 'production';

if (isProduction) {
  const missing = REQUIRED_IN_PRODUCTION
    .map((entry) => entry.key)
    .filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(formatMissingEnvError(missing));
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

  databaseUrl: isProduction ? requireEnv('DATABASE_URL') : (getEnv('DATABASE_URL') ?? ''),

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
