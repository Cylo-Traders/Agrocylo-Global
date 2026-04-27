import { PrismaClient } from "@prisma/client";
import logger from "../config/logger.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function connectDB(): Promise<void> {
  await prisma.$connect();
  logger.info("Database connected");
}

export async function disconnectDB(): Promise<void> {
  await prisma.$disconnect();
  logger.info("Database disconnected");
}
