import "dotenv/config";
import { defineConfig } from "prisma/config";

if (!process.env["DATABASE_URL"]) {
  throw new Error("DATABASE_URL is required for Prisma commands");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
