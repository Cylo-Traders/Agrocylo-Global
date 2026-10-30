import type { Request, Response } from "express";
import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry } from "./registry.js";

let cachedDocument: ReturnType<OpenApiGeneratorV3["generateDocument"]> | null = null;

export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Agrocylo Production API",
      version: "1.0.0",
      description:
        "REST API for campaign funding, investments, orders, and campaign images. Schemas are generated from Zod definitions in agro-production/server.",
    },
    servers: [{ url: "/", description: "Current host" }],
    tags: [
      { name: "Authentication", description: "Wallet-based authentication using challenge-response pattern" },
      { name: "Health" },
      { name: "Campaigns" },
      { name: "Investments" },
      { name: "Orders" },
      { name: "Group Orders" },
      { name: "Transactions" },
      { name: "Campaign Images" },
    ],
  });
}

export function getOpenApiDocument() {
  if (!cachedDocument) {
    cachedDocument = generateOpenApiDocument();
  }
  return cachedDocument;
}

export function serveOpenApiDocument(_req: Request, res: Response): void {
  res.type("application/json").json(getOpenApiDocument());
}
