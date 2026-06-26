import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { mockVerifySession } = vi.hoisted(() => ({
  mockVerifySession: vi.fn(),
}));

vi.mock("../services/walletAuthService.js", () => ({
  verifySession: mockVerifySession,
}));

vi.mock("express-rate-limit", () => ({
  default: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../db/client.js", () => ({
  prisma: {
    campaign: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    investment: {
      findMany: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
    order: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      upsert: vi.fn(),
    },
  },
  connectDB: vi.fn(),
}));

vi.mock("../services/wsServer.js", () => ({
  broadcast: vi.fn(),
  attachWebSocketServer: vi.fn(),
}));

import app from "../app.js";
import { prisma } from "../db/client.js";

// Valid test fixtures — Stellar addresses must be 56 chars (G + 55 alphanumeric)
const FARMER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const INVESTOR = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const BUYER = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const TOKEN = "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
const CAMPAIGN_UUID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const ORDER_UUID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const INVESTMENT_UUID = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const FUTURE_DATE = "2030-01-01T00:00:00.000Z";
const NOW = new Date().toISOString();

const mockCampaign = {
  id: CAMPAIGN_UUID,
  onChainId: "on-chain-id-1",
  farmerAddress: FARMER,
  tokenAddress: TOKEN,
  targetAmount: "1000",
  totalRaised: "0",
  totalRevenue: "0",
  deadline: new Date(FUTURE_DATE),
  status: "FUNDING" as const,
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
  _count: { investments: 0, orders: 0 },
};

const mockInvestment = {
  id: INVESTMENT_UUID,
  campaignId: CAMPAIGN_UUID,
  investorAddress: INVESTOR,
  amount: "100",
  ledger: 100,
  createdAt: new Date(NOW),
};

const mockOrder = {
  id: ORDER_UUID,
  onChainId: "pending",
  campaignId: CAMPAIGN_UUID,
  buyerAddress: BUYER,
  amount: "50",
  status: "PENDING" as const,
  ledger: 0,
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
};

const db = prisma as {
  campaign: Record<string, ReturnType<typeof vi.fn>>;
  investment: Record<string, ReturnType<typeof vi.fn>>;
  order: Record<string, ReturnType<typeof vi.fn>>;
  user: Record<string, ReturnType<typeof vi.fn>>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Campaign endpoints
// ---------------------------------------------------------------------------

describe("GET /api/v1/campaigns", () => {
  it("returns a paginated list of campaigns", async () => {
    db.campaign.findMany.mockResolvedValue([mockCampaign]);
    db.campaign.count.mockResolvedValue(1);

    const res = await request(app).get("/api/v1/campaigns");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(CAMPAIGN_UUID);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.meta.page).toBe(1);
  });

  it("filters campaigns by status", async () => {
    db.campaign.findMany.mockResolvedValue([]);
    db.campaign.count.mockResolvedValue(0);

    const res = await request(app).get("/api/v1/campaigns?status=FUNDED");

    expect(res.status).toBe(200);
    expect(db.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "FUNDED" }) }),
    );
  });

  it("filters campaigns by farmerAddress", async () => {
    db.campaign.findMany.mockResolvedValue([mockCampaign]);
    db.campaign.count.mockResolvedValue(1);

    const res = await request(app).get(`/api/v1/campaigns?farmerAddress=${FARMER}`);

    expect(res.status).toBe(200);
    expect(db.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ farmerAddress: FARMER }) }),
    );
  });

  it("returns 400 for invalid status value", async () => {
    const res = await request(app).get("/api/v1/campaigns?status=INVALID");

    expect(res.status).toBe(400);
    expect(res.body.title).toBe("Validation Failed");
  });

  it("returns 400 for malformed Stellar address", async () => {
    const res = await request(app).get("/api/v1/campaigns?farmerAddress=notanaddress");

    expect(res.status).toBe(400);
    expect(res.body.title).toBe("Validation Failed");
  });
});

describe("GET /api/v1/campaigns/:id", () => {
  it("returns a campaign with investments and orders", async () => {
    db.campaign.findUnique.mockResolvedValue({
      ...mockCampaign,
      investments: [mockInvestment],
      orders: [],
    });

    const res = await request(app).get(`/api/v1/campaigns/${CAMPAIGN_UUID}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(CAMPAIGN_UUID);
    expect(res.body.investments).toHaveLength(1);
  });

  it("returns 404 when campaign is not found", async () => {
    db.campaign.findUnique.mockResolvedValue(null);

    const res = await request(app).get(`/api/v1/campaigns/${CAMPAIGN_UUID}`);

    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-UUID id", async () => {
    const res = await request(app).get("/api/v1/campaigns/not-a-uuid");

    expect(res.status).toBe(400);
    expect(res.body.title).toBe("Validation Failed");
  });
});

describe("POST /api/v1/campaigns", () => {
  beforeEach(() => {
    mockVerifySession.mockResolvedValue({
      walletAddress: FARMER,
      sessionToken: "test-session",
    });
  });

  it("creates a campaign and returns 201", async () => {
    db.campaign.create.mockResolvedValue(mockCampaign);
    db.user.upsert.mockResolvedValue({});

    const res = await request(app)
      .post("/api/v1/campaigns")
      .set("Authorization", "Bearer test-session")
      .send({
        tokenAddress: TOKEN,
        targetAmount: "1000",
        deadline: FUTURE_DATE,
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(CAMPAIGN_UUID);
    expect(db.campaign.create).toHaveBeenCalledOnce();
  });

  it("returns 400 for a past deadline", async () => {
    const res = await request(app)
      .post("/api/v1/campaigns")
      .set("Authorization", "Bearer test-session")
      .send({
        tokenAddress: TOKEN,
        targetAmount: "1000",
        deadline: "2000-01-01T00:00:00.000Z",
      });

    expect(res.status).toBe(400);
    expect(res.body.title).toBe("Validation Failed");
  });

  it("returns 400 for a zero amount", async () => {
    const res = await request(app)
      .post("/api/v1/campaigns")
      .set("Authorization", "Bearer test-session")
      .send({
        tokenAddress: TOKEN,
        targetAmount: "0",
        deadline: FUTURE_DATE,
      });

    expect(res.status).toBe(400);
    expect(res.body.title).toBe("Validation Failed");
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app)
      .post("/api/v1/campaigns")
      .set("Authorization", "Bearer test-session")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Investment endpoints
// ---------------------------------------------------------------------------

describe("GET /api/v1/campaigns/:id/investments", () => {
  it("returns investments for a campaign", async () => {
    db.investment.findMany.mockResolvedValue([mockInvestment]);

    const res = await request(app).get(`/api/v1/campaigns/${CAMPAIGN_UUID}/investments`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].investorAddress).toBe(INVESTOR);
  });

  it("returns empty array when no investments exist", async () => {
    db.investment.findMany.mockResolvedValue([]);

    const res = await request(app).get(`/api/v1/campaigns/${CAMPAIGN_UUID}/investments`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe("GET /api/v1/investments", () => {
  it("returns investments for an investor address", async () => {
    db.investment.findMany.mockResolvedValue([mockInvestment]);

    const res = await request(app).get(`/api/v1/investments?investorAddress=${INVESTOR}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("returns 400 when investorAddress is missing", async () => {
    const res = await request(app).get("/api/v1/investments");

    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid Stellar address", async () => {
    const res = await request(app).get("/api/v1/investments?investorAddress=bad");

    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/campaigns/:id/invest", () => {
  beforeEach(() => {
    mockVerifySession.mockResolvedValue({
      walletAddress: INVESTOR,
      sessionToken: "test-session",
    });
  });

  it("records an investment and returns 201", async () => {
    db.campaign.findUnique.mockResolvedValue(mockCampaign);
    db.investment.create.mockResolvedValue(mockInvestment);
    db.user.upsert.mockResolvedValue({});

    const res = await request(app)
      .post(`/api/v1/campaigns/${CAMPAIGN_UUID}/invest`)
      .set("Authorization", "Bearer test-session")
      .send({ amount: "100" });

    expect(res.status).toBe(201);
    expect(db.investment.create).toHaveBeenCalledOnce();
  });

  it("returns 404 when the campaign does not exist", async () => {
    db.campaign.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/v1/campaigns/${CAMPAIGN_UUID}/invest`)
      .set("Authorization", "Bearer test-session")
      .send({ amount: "100" });

    expect(res.status).toBe(404);
  });

  it("returns 409 when the campaign is not in FUNDING status", async () => {
    db.campaign.findUnique.mockResolvedValue({ ...mockCampaign, status: "FUNDED" });

    const res = await request(app)
      .post(`/api/v1/campaigns/${CAMPAIGN_UUID}/invest`)
      .set("Authorization", "Bearer test-session")
      .send({ amount: "100" });

    expect(res.status).toBe(409);
  });

  it("returns 400 for a zero investment amount", async () => {
    const res = await request(app)
      .post(`/api/v1/campaigns/${CAMPAIGN_UUID}/invest`)
      .set("Authorization", "Bearer test-session")
      .send({ amount: "0" });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Order endpoints
// ---------------------------------------------------------------------------

describe("GET /api/v1/orders", () => {
  it("returns orders for a buyer address", async () => {
    db.order.findMany.mockResolvedValue([mockOrder]);

    const res = await request(app).get(`/api/v1/orders?buyerAddress=${BUYER}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].buyerAddress).toBe(BUYER);
  });

  it("returns orders for a farmer address", async () => {
    db.campaign.findMany.mockResolvedValue([{ id: CAMPAIGN_UUID }]);
    db.order.findMany.mockResolvedValue([mockOrder]);

    const res = await request(app).get(`/api/v1/orders?farmerAddress=${FARMER}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("returns 400 when neither address is provided", async () => {
    const res = await request(app).get("/api/v1/orders");

    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid Stellar address", async () => {
    const res = await request(app).get("/api/v1/orders?buyerAddress=bad");

    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/orders", () => {
  beforeEach(() => {
    mockVerifySession.mockResolvedValue({
      walletAddress: BUYER,
      sessionToken: "test-session",
    });
  });

  it("creates an order for a HARVESTED campaign and returns 201", async () => {
    db.campaign.findUnique.mockResolvedValue({ ...mockCampaign, status: "HARVESTED" });
    db.order.create.mockResolvedValue(mockOrder);
    db.user.upsert.mockResolvedValue({});

    const res = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", "Bearer test-session")
      .send({
        campaignId: CAMPAIGN_UUID,
        amount: "50",
      });

    expect(res.status).toBe(201);
    expect(db.order.create).toHaveBeenCalledOnce();
  });

  it("creates an order for an IN_PRODUCTION campaign", async () => {
    db.campaign.findUnique.mockResolvedValue({ ...mockCampaign, status: "IN_PRODUCTION" });
    db.order.create.mockResolvedValue(mockOrder);
    db.user.upsert.mockResolvedValue({});

    const res = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", "Bearer test-session")
      .send({
        campaignId: CAMPAIGN_UUID,
        amount: "50",
      });

    expect(res.status).toBe(201);
  });

  it("returns 404 when the campaign does not exist", async () => {
    db.campaign.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", "Bearer test-session")
      .send({
        campaignId: CAMPAIGN_UUID,
        amount: "50",
      });

    expect(res.status).toBe(404);
  });

  it("returns 409 when the campaign is still in FUNDING status", async () => {
    db.campaign.findUnique.mockResolvedValue({ ...mockCampaign, status: "FUNDING" });

    const res = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", "Bearer test-session")
      .send({
        campaignId: CAMPAIGN_UUID,
        amount: "50",
      });

    expect(res.status).toBe(409);
  });

  it("returns 400 when campaignId is not a UUID", async () => {
    const res = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", "Bearer test-session")
      .send({
        campaignId: "not-a-uuid",
        amount: "50",
      });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/orders/:id", () => {
  it("returns an order by id", async () => {
    db.order.findUnique.mockResolvedValue(mockOrder);

    const res = await request(app).get(`/api/v1/orders/${ORDER_UUID}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ORDER_UUID);
  });

  it("returns 404 when order is not found", async () => {
    db.order.findUnique.mockResolvedValue(null);

    const res = await request(app).get(`/api/v1/orders/${ORDER_UUID}`);

    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-UUID id", async () => {
    const res = await request(app).get("/api/v1/orders/not-a-uuid");

    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/v1/orders/:id/confirm", () => {
  beforeEach(() => {
    mockVerifySession.mockResolvedValue({
      walletAddress: BUYER,
      sessionToken: "test-session",
    });
  });

  it("confirms a pending order", async () => {
    db.order.findUnique.mockResolvedValue(mockOrder);
    db.order.update.mockResolvedValue({ ...mockOrder, status: "CONFIRMED" });

    const res = await request(app)
      .patch(`/api/v1/orders/${ORDER_UUID}/confirm`)
      .set("Authorization", "Bearer test-session");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CONFIRMED");
  });

  it("returns 404 when the order does not exist", async () => {
    db.order.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/v1/orders/${ORDER_UUID}/confirm`)
      .set("Authorization", "Bearer test-session");

    expect(res.status).toBe(404);
  });

  it("returns 403 when a different buyer tries to confirm", async () => {
    mockVerifySession.mockResolvedValue({
      walletAddress: INVESTOR, // different from BUYER who owns the order
      sessionToken: "test-session",
    });
    db.order.findUnique.mockResolvedValue(mockOrder);

    const res = await request(app)
      .patch(`/api/v1/orders/${ORDER_UUID}/confirm`)
      .set("Authorization", "Bearer test-session");

    expect(res.status).toBe(403);
  });

  it("returns 409 when the order is already confirmed", async () => {
    db.order.findUnique.mockResolvedValue({ ...mockOrder, status: "CONFIRMED" });

    const res = await request(app)
      .patch(`/api/v1/orders/${ORDER_UUID}/confirm`)
      .set("Authorization", "Bearer test-session");

    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Utility endpoints
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  it("returns status UP", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("UP");
    expect(res.body.service).toBe("agro-production-server");
  });
});

describe("GET /metrics/events", () => {
  it("returns event processing metrics", async () => {
    const res = await request(app).get("/metrics/events");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("processed");
    expect(res.body).toHaveProperty("skipped_duplicates");
    expect(res.body).toHaveProperty("parse_errors");
    expect(res.body).toHaveProperty("persist_errors");
    expect(res.body).toHaveProperty("by_action");
  });
});

describe("GET /metrics/rate-limits", () => {
  it("returns rate limit hit counters", async () => {
    const res = await request(app).get("/metrics/rate-limits");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("default_hits");
    expect(res.body).toHaveProperty("write_hits");
    expect(res.body).toHaveProperty("total_hits");
  });
});

describe("Unknown routes", () => {
  it("returns 404 for an unregistered path", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");

    expect(res.status).toBe(404);
  });
});
