import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import logger from './config/logger.js';
import { config } from './config/index.js';
import productImageRoutes, { productImageErrorHandler } from './routes/productImageRoutes.js';
import productRoutes, { apiErrorHandler } from './routes/productRoutes.js';
import cartRoutes from './routes/cartRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import authRoutes from './routes/authRoutes.js';
import profileRoutes, { profileErrorHandler } from './routes/profileRoutes.js';
import locationRoutes, { locationErrorHandler } from './routes/locationRoutes.js';
import orderMetadataRoutes, { orderErrorHandler } from './routes/orderMetadataRoutes.js';
import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import logger from "./config/logger.js";
import { config } from "./config/index.js";
import productImageRoutes, {
  productImageErrorHandler,
} from "./routes/productImageRoutes.js";
import productRoutes, { apiErrorHandler } from "./routes/productRoutes.js";
import cartRoutes from "./routes/cartRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import profileRoutes, { profileErrorHandler } from "./routes/profileRoutes.js";
import locationRoutes, {
  locationErrorHandler,
} from "./routes/locationRoutes.js";
import orderRoutes, {
  orderErrorHandler,
} from "./routes/orderMetadataRoutes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use('/auth', authRoutes);
app.use(productImageRoutes);
app.use(productRoutes);
app.use(cartRoutes);
app.use(orderMetadataRoutes);
app.use(profileRoutes);
app.use(locationRoutes);
app.use('/orders', orderRoutes);
app.use("/auth", authRoutes);
app.use(profileRoutes);
app.use(locationRoutes);
app.use(orderRoutes);

app.get("/health", (req: Request, res: Response) => {
  logger.info("Health check endpoint hit");
  res.status(200).json({
    status: "UP",
    timestamp: new Date().toISOString(),
    service: "Agrocylo-Backend",
    env: config.nodeEnv,
  });
});

app.use(productImageErrorHandler);
app.use(apiErrorHandler);
app.use((err: unknown, _req: Request, res: Response, _next: () => void) => {
  logger.error("Unhandled request error", err);
  res.status(500).json({ message: "Internal server error" });
});
app.use(profileErrorHandler);
app.use(locationErrorHandler);
app.use(orderErrorHandler);
app.use((err: unknown, _req: Request, res: Response, _next: () => void) => {
  logger.error('Unhandled request error', err);
  res.status(500).json({ message: 'Internal server error' });
});

export default app;
