import "dotenv/config";
import { defineConfig } from "prisma/config";

const datasourceUrl =
  process.env["DATABASE_URL"]?.trim() ||
  process.env["PRISMA_GENERATE_DATABASE_URL"]?.trim();

if (!datasourceUrl) {
  throw new Error(
    "DATABASE_URL is required for database commands. " +
      "Artifact-only generation may set PRISMA_GENERATE_DATABASE_URL to a nonsecret placeholder.",
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: datasourceUrl,
  },
});
