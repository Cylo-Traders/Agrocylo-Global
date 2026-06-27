import "dotenv/config";
import { z } from "zod";
import { validateContractWatcherConfig } from "./validateContractWatcher.js";

const booleanFromEnv = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((value) => value === "true" || value === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SUPABASE_URL: z.url("SUPABASE_URL must be a valid URL"),
  SUPABASE_ANON_KEY: z.string().min(1, "SUPABASE_ANON_KEY is required"),
  REDIS_URL: z.url().default("redis://127.0.0.1:6379"),
  RUN_WORKERS: booleanFromEnv.default(false),
  RUN_CONTRACT_WATCHER: booleanFromEnv.default(false),
  METRICS_API_KEY: z.string().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  SUPABASE_PRODUCT_IMAGES_BUCKET: z.string().min(1).default("product-images"),
  PRODUCT_IMAGE_PLACEHOLDER_URL: z.url().default("https://placehold.co/800x800/png?text=No+Image"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be set and at least 32 characters long")
    .refine((value) => !["changeme", "dev-secret", "dev-secret-change-in-production"].includes(value), {
      message: "JWT_SECRET cannot use default values. Please set a strong secret.",
    }),
  CONTRACT_ID: z.string().default(""),
  RPC_URL: z.url().default("https://soroban-testnet.stellar.org"),
  WS_PATH: z.string().min(1).default("/ws"),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const details = parsedEnv.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

const env = parsedEnv.data;

// Fail fast: prevent the server from starting in a misconfigured contract-watch state.
validateContractWatcherConfig(env.RUN_CONTRACT_WATCHER, env.CONTRACT_ID);

export const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  allowedOrigins: env.ALLOWED_ORIGINS.split(",").map(origin => origin.trim()),
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
