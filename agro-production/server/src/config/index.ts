import 'dotenv/config';

export const config = {
  port: parseInt(process.env['PORT'] ?? '5001', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  logLevel: process.env['LOG_LEVEL'] ?? 'debug',

  databaseUrl: process.env['DATABASE_URL'] ?? '',

  rpcUrl: process.env['RPC_URL'] ?? 'https://soroban-testnet.stellar.org',
  // Used by the upstream production watcher (single contract)
  contractId: process.env['PRODUCTION_CONTRACT_ID'] ?? '',
  // Used by our multi-contract Soroban event listener
  escrowContractId: process.env['ESCROW_CONTRACT_ID'] ?? '',
  productionEscrowContractId:
    process.env['PRODUCTION_ESCROW_CONTRACT_ID'] ??
    process.env['PRODUCTION_CONTRACT_ID'] ??
    '',

  rateLimitWindowMs: parseInt(process.env['RATE_LIMIT_WINDOW_MS'] ?? '60000', 10),
  rateLimitMaxRequests: parseInt(process.env['RATE_LIMIT_MAX_REQUESTS'] ?? '100', 10),

  // Supabase — campaign image upload (Issue #155)
  supabaseUrl: process.env['SUPABASE_URL'] ?? '',
  supabaseAnonKey: process.env['SUPABASE_ANON_KEY'] ?? '',
  supabaseServiceRoleKey: process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '',
  campaignImagesBucket:
    process.env['SUPABASE_CAMPAIGN_IMAGES_BUCKET'] ?? 'campaign-images',
  campaignImagePlaceholderUrl:
    process.env['CAMPAIGN_IMAGE_PLACEHOLDER_URL'] ??
    'https://placehold.co/800x800/png?text=No+Image',
};
