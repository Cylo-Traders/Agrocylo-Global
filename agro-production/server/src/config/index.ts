import "dotenv/config";

export const config = {
  port: parseInt(process.env.PORT ?? "3001", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: process.env.DATABASE_URL ?? "",
  rpcUrl: process.env.RPC_URL ?? "https://soroban-testnet.stellar.org",
  contractId: process.env.PRODUCTION_CONTRACT_ID ?? "",
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10),
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? "100", 10),
};
