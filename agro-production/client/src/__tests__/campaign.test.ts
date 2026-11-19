import { describe, it, expect, beforeEach, vi } from "vitest";
import { fetchCampaigns } from "../services/campaignService";

const mockCampaigns = { items: [{ id: "c1", title: "Test" }], total: 1 };

describe("campaignService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchCampaigns returns parsed list", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockCampaigns), headers: new Map([['content-type','application/json']]) } as unknown as Response),
    );

    const res = await fetchCampaigns();
    expect(res).toEqual(mockCampaigns);
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});
