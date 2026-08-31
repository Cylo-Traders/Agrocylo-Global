import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import * as Sentry from "@sentry/node";
import logger from "./config/logger.js";
import { config } from "./config/index.js";
import { initializeSentry, extractTraceContext, withSpan } from "./config/observability.js";
import { prisma } from "./config/database.js";
import { getSupabaseAdmin } from "./config/supabase.js";
import {
  incrementRequestCount,
  incrementErrorCount,
} from "./services/metricsService.js";
import { ApiError, sendProblem } from "./http/errors.js";
import { requestContext } from "./middleware/requestContext.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { createIdempotencyMiddleware } from "./middleware/idempotency.js";
import { sharedRedisClient } from "./middleware/rateLimiter.js";
import productImageRoutes, {
  productImageErrorHandler,
} from "./routes/productImageRoutes.js";
import productRoutes, { apiErrorHandler } from "./routes/productRoutes.js";
import cartRoutes from "./routes/cartRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import orderRoutes, { orderErrorHandler } from "./routes/orderRoutes.js";
import orderMetadataRoutes from "./routes/orderMetadataRoutes.js";
import profileRoutes, { profileErrorHandler } from "./routes/profileRoutes.js";
import graphqlRoutes, { graphqlErrorHandler } from "./routes/graphqlRoutes.js";
import locationRoutes, {
  locationErrorHandler,
} from "./routes/locationRoutes.js";
import notificationRoutes, {
  notificationErrorHandler,
} from "./routes/notificationRoutes.js";
import jobRoutes from "./routes/jobRoutes.js";
import demandSupplyRoutes from "./routes/demandSupplyRoutes.js";
import metricsRoutes from "./routes/metricsRoutes.js";
import adminRoutes, { adminErrorHandler } from "./routes/adminRoutes.js";
import adminReconciliationRoutes from "./routes/adminReconciliationRoutes.js";
import disputeRoutes, { disputeUploadErrorHandler } from "./routes/disputeRoutes.js";
import cropPlanRoutes from "./routes/cropPlanRoutes.js";
import equipmentRoutes from "./routes/equipmentRoutes.js";
import groupOrderRoutes, { groupOrderErrorHandler } from "./routes/groupOrderRoutes.js";
import referralRoutes, { referralErrorHandler } from "./routes/referralRoutes.js";
import integratorRoutes, { integratorErrorHandler } from "./routes/integratorRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import governanceRoutes from "./routes/governanceRoutes.js";
import ussdRoutes from "./routes/ussdRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import { registerAllEndpoints } from "./openapi/endpoints.js";

// Initialize error tracking and tracing
initializeSentry('api');

const app = express();

// Sentry request handler must be the first middleware (Sentry v8 removed Handlers — guard for tests)
if ((Sentry as unknown as { Handlers?: { requestHandler: () => import("express").Handler } }).Handlers?.requestHandler) {
  app.use((Sentry as unknown as { Handlers: { requestHandler: () => import("express").Handler } }).Handlers.requestHandler());
}

// Trust proxy to correctly extract client IP from X-Forwarded-For
app.set('trust proxy', 1);

// Security headers middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
    },
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: config.nodeEnv === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
}));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || config.allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 3600,
}));
app.use(express.json());
app.use(requestContext);
app.use(requestLogger);

// Idempotency middleware (if Redis is available)
if (sharedRedisClient) {
  app.use(createIdempotencyMiddleware(sharedRedisClient));
}

// Metrics middleware
app.use((_req, _res, next) => {
  incrementRequestCount();
  next();
});

app.use("/auth", authRoutes);
app.use(productImageRoutes);
app.use(productRoutes);
app.use(cartRoutes);
app.use("/orders", orderRoutes);
app.use("/orders/metadata", orderMetadataRoutes);
app.use(profileRoutes);
app.use(locationRoutes);
app.use(notificationRoutes);
app.use("/disputes", disputeRoutes);
app.use(groupOrderRoutes);
app.use("/graphql", graphqlRoutes);
app.use(demandSupplyRoutes);
app.use(analyticsRoutes);
app.use(jobRoutes);
app.use(cropPlanRoutes);
app.use(equipmentRoutes);
app.use("/admin", adminRoutes);
app.use("/admin/reconciliation", adminReconciliationRoutes);
app.use(referralRoutes);
app.use(integratorRoutes);
app.use(governanceRoutes);
app.use(ussdRoutes);

// Documentation endpoints (OpenAPI spec and Swagger UI)
app.use(documentRoutes);

app.get("/health", async (_req: Request, res: Response) => {
  logger.info("Health check endpoint hit");

  const health = {
    status: "UP",
    timestamp: new Date().toISOString(),
    service: "Agrocylo-Backend",
    env: config.nodeEnv,
    database: "DOWN",
    supabase: "DOWN",
  };

  // Check database connectivity
  try {
    // Raw SQL is limited to this static health probe; it accepts no user input or dynamic parameters.
    await prisma.$queryRaw`SELECT 1`;
    health.database = "UP";
  } catch (error) {
    logger.error("Database health check failed", error);
    health.status = "DOWN";
  }

  // Check Supabase connectivity
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("profiles")
      .select("count")
      .limit(1)
      .maybeSingle();
    if (!error) {
      health.supabase = "UP";
    } else {
      logger.error("Supabase health check failed", error);
      health.status = "DOWN";
    }
  } catch (error) {
    logger.error("Supabase health check failed", error);
    health.status = "DOWN";
  }

  const statusCode = health.status === "UP" ? 200 : 503;
  res.status(statusCode).json(health);
});

app.use(metricsRoutes);

app.use(productImageErrorHandler);
app.use(disputeUploadErrorHandler);
app.use(apiErrorHandler);
app.use(profileErrorHandler);
app.use(locationErrorHandler);
app.use(orderErrorHandler);
app.use(notificationErrorHandler);
app.use(groupOrderErrorHandler);
app.use(graphqlErrorHandler);
app.use(adminErrorHandler);
app.use(referralErrorHandler);
app.use(integratorErrorHandler);

// Sentry error handler must be before other error handlers (guard for v8)
if ((Sentry as unknown as { Handlers?: { errorHandler: () => import("express").ErrorRequestHandler } }).Handlers?.errorHandler) {
  app.use((Sentry as unknown as { Handlers: { errorHandler: () => import("express").ErrorRequestHandler } }).Handlers.errorHandler());
}

app.use((err: unknown, req: Request, res: Response, _next: () => void) => {
  incrementErrorCount();
  if (err instanceof ApiError) {
    // Client-facing API errors (4xx/5xx with a deliberate ApiError) are
    // expected control flow, not incidents — only report actual 5xx ApiErrors
    // to Sentry, so validation/auth/not-found noise doesn't drown real alerts.
    if (err.status >= 500) {
      Sentry.captureException(err);
    }
    sendProblem(res, req, err);
    return;
  }
  logger.error("Unhandled request error", err);
  Sentry.captureException(err);
  sendProblem(res, req, new ApiError(500, "Internal Server Error", "An unexpected error occurred"));
});

export default app;
