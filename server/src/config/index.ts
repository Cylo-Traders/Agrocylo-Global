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
  ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  INTEGRATOR_API_KEY_PEPPER: z.string().min(32).default("development-only-integrator-pepper-change-me"),
  INTEGRATOR_MONTHLY_QUOTA: z.coerce.number().int().positive().default(10_000),
  SUPABASE_PRODUCT_IMAGES_BUCKET: z.string().min(1).default("product-images"),
  PRODUCT_IMAGE_PLACEHOLDER_URL: z.url().default("https://placehold.co/800x800/png?text=No+Image"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be set and at least 32 characters long")
    .refine((value) => !["changeme", "dev-secret", "dev-secret-change-in-production"].includes(value), {
      message: "JWT_SECRET cannot use default values. Please set a strong secret.",
    }),
  CONTRACT_ID: z.string().default(""),
  GOVERNANCE_CONTRACT_ID: z.string().default(""),
  RPC_URL: z.url().default("https://soroban-testnet.stellar.org"),
  WS_PATH: z.string().min(1).default("/ws"),
  // Observability (Issue #756). Empty string disables Sentry entirely — the
  // SDK is designed to safely no-op without a DSN, so this is optional in
  // every environment except wherever alerts actually need to fire.
  SENTRY_DSN: z.string().default(""),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  ADMIN_WALLETS: z.string().default(""),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV !== "production") return;
  for (const key of ["METRICS_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
    if (!env[key].trim()) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required in production` });
  }
  const origins = env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (!origins.length || origins.some((origin) => {
    try { return new URL(origin).protocol !== "https:"; } catch { return true; }
  })) {
    ctx.addIssue({ code: "custom", path: ["ALLOWED_ORIGINS"], message: "ALLOWED_ORIGINS must contain only valid https:// origins in production" });
  }
  if (env.INTEGRATOR_API_KEY_PEPPER === "development-only-integrator-pepper-change-me") {
    ctx.addIssue({ code: "custom", path: ["INTEGRATOR_API_KEY_PEPPER"], message: "INTEGRATOR_API_KEY_PEPPER must be private in production" });
  }
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
validateContractWatcherConfig(
  env.RUN_CONTRACT_WATCHER,
  env.CONTRACT_ID,
  env.GOVERNANCE_CONTRACT_ID,
);

export const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  allowedOrigins: env.ALLOWED_ORIGINS.split(",").map(origin => origin.trim()),
  redisUrl: env.REDIS_URL,
  runWorkers: env.RUN_WORKERS,
  runContractWatcher: env.RUN_CONTRACT_WATCHER,
  metricsApiKey: env.METRICS_API_KEY,
  integratorApiKeyPepper: env.INTEGRATOR_API_KEY_PEPPER,
  integratorMonthlyQuota: env.INTEGRATOR_MONTHLY_QUOTA,
  supabaseUrl: env.SUPABASE_URL,
  supabaseAnonKey: env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  productImagesBucket: env.SUPABASE_PRODUCT_IMAGES_BUCKET,
  productImagePlaceholderUrl: env.PRODUCT_IMAGE_PLACEHOLDER_URL,
  jwtSecret: env.JWT_SECRET,
  contractId: env.CONTRACT_ID,
  governanceContractId: env.GOVERNANCE_CONTRACT_ID,
  rpcUrl: env.RPC_URL,
  wsPath: env.WS_PATH,
  sentryDsn: env.SENTRY_DSN,
  sentryTracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  adminWallets: env.ADMIN_WALLETS.split(",")
    .map((w) => w.trim().toUpperCase())
    .filter(Boolean),
};
