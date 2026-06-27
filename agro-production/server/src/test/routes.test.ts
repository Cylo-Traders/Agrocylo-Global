import { describe, it, expect, vi } from "vitest";
import request from "supertest";

vi.mock("../db/client.js", () => ({
  prisma: {
    campaign: { count: vi.fn(() => Promise.resolve(0)) },
    connectDB: vi.fn(),
  },
}));

vi.mock("../services/wsServer.js", () => ({
  broadcast: vi.fn(),
  attachWebSocketServer: vi.fn(),
  closeWebSocketServer: vi.fn(),
}));

import app from "../app.js";

describe("Route Registration", () => {
  it("should have campaign routes mounted at /api/v1", async () => {
    const response = await request(app).get("/api/v1/campaigns");
    expect(response.status).not.toBe(404);
  });

  it("should have order routes mounted at /api/v1", async () => {
    const response = await request(app).get("/api/v1/orders");
    expect(response.status).not.toBe(404);
  });

  it("should have transaction routes mounted at /api/v1", async () => {
    const response = await request(app).get("/api/v1/transactions");
    expect(response.status).not.toBe(404);
  });

  it("should not have stale campaignRoutes mounted", async () => {
    const response = await request(app).get("/api/v1/campaigns-deprecated");
    expect(response.status).toBe(404);
  });

  it("should not have stale campaignController endpoints", async () => {
    const response = await request(app).post("/api/v1/campaigns/legacy-create");
    expect(response.status).toBe(404);
  });

  it("should have health endpoints available", async () => {
    const healthResponse = await request(app).get("/health");
    expect(healthResponse.status).toBe(200);

    const livezResponse = await request(app).get("/livez");
    expect(livezResponse.status).toBe(200);

    const readyzResponse = await request(app).get("/readyz");
    expect(readyzResponse.status).not.toBe(404);
  });
});
