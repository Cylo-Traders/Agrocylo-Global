import 'dotenv/config';
import logger from './logger.js';

const requiredEnvs = ['PORT', 'NODE_ENV'];
requiredEnvs.forEach((key) => {
  if (!process.env[key]) {
    logger.warn(`Environment variable ${key} is missing. Using default.`);
  }
});

export const config = {
  port: process.env['PORT'] ?? 5001,
  nodeEnv: process.env['NODE_ENV'] ?? 'development',

  rpcUrl: process.env['RPC_URL'] ?? 'https://soroban-testnet.stellar.org',
  escrowContractId: process.env['ESCROW_CONTRACT_ID'] ?? '',
  productionEscrowContractId: process.env['PRODUCTION_ESCROW_CONTRACT_ID'] ?? '',

  supabaseUrl: process.env['SUPABASE_URL'] ?? '',
  supabaseAnonKey: process.env['SUPABASE_ANON_KEY'] ?? '',
  supabaseServiceRoleKey: process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '',
  campaignImagesBucket: process.env['SUPABASE_CAMPAIGN_IMAGES_BUCKET'] ?? 'campaign-images',
  campaignImagePlaceholderUrl:
    process.env['CAMPAIGN_IMAGE_PLACEHOLDER_URL'] ??
    'https://placehold.co/800x800/png?text=No+Image',

  databaseUrl: process.env['DATABASE_URL'] ?? '',
};
