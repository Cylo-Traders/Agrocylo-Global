import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import logger from "./config/logger.js";
import { config } from "./config/index.js";
import { defaultLimiter } from "./middleware/rateLimit.js";
import campaignRoutes from "./routes/campaigns.js";
import orderRoutes from "./routes/orders.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(defaultLimiter);

app.use("/api/v1", campaignRoutes);
app.use("/api/v1", orderRoutes);

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "UP", service: "agro-production-server", env: config.nodeEnv });
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error("Unhandled error", err);
  res.status(500).json({ error: "Internal server error" });
});

export default app;
