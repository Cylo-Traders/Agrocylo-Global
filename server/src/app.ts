import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import logger from "./config/logger.js";
import { config } from "./config/index.js";
import { prisma } from "./config/database.js";
import { getSupabaseAdmin } from "./config/supabase.js";
import {
  incrementRequestCount,
  incrementErrorCount,
} from "./services/metricsService.js";
import { requestContext } from "./middleware/requestContext.js";
import { requestLogger } from "./middleware/requestLogger.js";
import productImageRoutes, {
  productImageErrorHandler,
} from "./routes/productImageRoutes.js";
import productRoutes, { apiErrorHandler } from "./routes/productRoutes.js";
import cartRoutes from "./routes/cartRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import orderRoutes, { orderErrorHandler } from "./routes/orderRoutes.js";
import orderMetadataRoutes from "./routes/orderMetadataRoutes.js";
import profileRoutes, { profileErrorHandler } from "./routes/profileRoutes.js";
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
import disputeRoutes from "./routes/disputeRoutes.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(requestContext);
app.use(requestLogger);

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
app.use(demandSupplyRoutes);
app.use(jobRoutes);
app.use("/admin", adminRoutes);

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
app.use(apiErrorHandler);
app.use(profileErrorHandler);
app.use(locationErrorHandler);
app.use(orderErrorHandler);
app.use(notificationErrorHandler);
app.use(adminErrorHandler);
app.use((err: unknown, _req: Request, res: Response, _next: () => void) => {
  incrementErrorCount();
  logger.error("Request failed", err);
  res.status(500).json({ message: "Internal server error" });
});

export default app;
