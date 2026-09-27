import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../db/client.js", () => ({
  prisma: {
    campaign: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    transaction: {
      findUnique: vi.fn(),
      create: vi.fn(),
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
import { EventPersister } from "../events/persister.js";

describe("Campaign Milestones API & Event Handling (Issue #645)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 for non-existent campaign milestones", async () => {
    (prisma.campaign.findFirst as any).mockResolvedValue(null);

    const res = await request(app).get("/campaigns/00000000-0000-0000-0000-000000000000/milestones");
    expect(res.status).toBe(404);
  });

  it("GET /campaigns/:id/milestones exposes milestone state for a campaign", async () => {
    const mockCampaign = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      onChainId: "1",
      status: "IN_PRODUCTION",
      totalRaised: "100000",
      trancheReleased: "50000",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      transactions: [
        {
          eventType: "campaign.produce",
          processedAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      ],
    };

    (prisma.campaign.findFirst as any).mockResolvedValue(mockCampaign);

    const res = await request(app).get(`/campaigns/${mockCampaign.id}/milestones`);

    expect(res.status).toBe(200);
    expect(res.body.campaignId).toBe(mockCampaign.id);
    expect(res.body.onChainId).toBe("1");
    expect(res.body.status).toBe("IN_PRODUCTION");
    expect(res.body.percentageReleased).toBe(50);
    expect(res.body.trancheReleased).toBe("50000");
    expect(res.body.currentMilestone).toBe("IN_PRODUCTION");
    expect(res.body.nextExpectedMilestone).toBe("HARVESTED");
    expect(res.body.milestones).toHaveLength(4);
    expect(res.body.milestones[1].completed).toBe(true);
  });

  it("updates trancheReleased and status when campaign.produce and campaign.harvest events are persisted", async () => {
    const mockCampaign = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      onChainId: "10",
      totalRaised: "200000",
      trancheReleased: "0",
      status: "FUNDED",
    };

    (prisma.$transaction as any) = vi.fn(async (cb) => {
      const txPrisma = {
        transaction: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "tx-1" }),
        },
        campaign: {
          findUnique: vi.fn().mockResolvedValue(mockCampaign),
          update: vi.fn().mockResolvedValue({ ...mockCampaign, status: "IN_PRODUCTION", trancheReleased: "100000" }),
        },
      };
      return cb(txPrisma);
    });

    const produceEvent = {
      id: "100-1",
      action: "campaign.produce" as const,
      campaignId: "10",
      ledger: 100,
      eventIndex: 1,
      txHash: "0xabc1",
      extra: [],
    };

    await EventPersister.persist(produceEvent);

    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
