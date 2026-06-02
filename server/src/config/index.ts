import "dotenv/config";
import { cleanEnv, str, port, bool, url } from "envalid";

const env = cleanEnv(process.env, {
  NODE_ENV: str({
    choices: ["development", "test", "production"],
    default: "development",
  }),
  PORT: port({ default: 5000 }),
  DATABASE_URL: str(),
  SUPABASE_URL: url(),
  SUPABASE_ANON_KEY: str(),
  REDIS_URL: str({ default: "redis://127.0.0.1:6379" }),
  RUN_WORKERS: bool({ default: false }),
  RUN_CONTRACT_WATCHER: bool({ default: true }),
  METRICS_API_KEY: str({ default: "" }),
  SUPABASE_SERVICE_ROLE_KEY: str({ default: "" }),
  SUPABASE_PRODUCT_IMAGES_BUCKET: str({ default: "product-images" }),
  PRODUCT_IMAGE_PLACEHOLDER_URL: str({
    default: "https://placehold.co/800x800/png?text=No+Image",
  }),
  JWT_SECRET: str({
    default: undefined,
    devDefault: "dev-secret-change-in-production",
    desc: "Secret key for signing JWT tokens. MUST be set in production.",
  }),
  CONTRACT_ID: str({ default: "" }),
  RPC_URL: str({ default: "https://soroban-testnet.stellar.org" }),
  WS_PATH: str({ default: "/ws" }),
});

// Enforce strong JWT secret in production
if (env.NODE_ENV === "production") {
  if (!process.env["JWT_SECRET"] || process.env["JWT_SECRET"].length < 32) {
    throw new Error(
      "JWT_SECRET must be set and at least 32 characters long in production environment",
    );
  }
  if (
    process.env["JWT_SECRET"] === "changeme" ||
    process.env["JWT_SECRET"] === "dev-secret"
  ) {
    throw new Error(
      "JWT_SECRET cannot use default values in production. Please set a strong secret.",
    );
  }
}

export const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  redisUrl: env.REDIS_URL,
  runWorkers: env.RUN_WORKERS,
  runContractWatcher: env.RUN_CONTRACT_WATCHER,
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
