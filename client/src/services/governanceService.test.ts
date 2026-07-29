import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGovernanceProposal,
  getGovernanceProposals,
  voteOnProposal,
} from "./governanceService";

afterEach(() => vi.unstubAllGlobals());

describe("governanceService", () => {
  it("loads indexed proposals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ proposalId: "7", status: "VOTING" }],
      }),
    );
    await expect(getGovernanceProposals()).resolves.toEqual([
      { proposalId: "7", status: "VOTING" },
    ]);
  });

  it("submits votes and parameter proposals", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => undefined });
    vi.stubGlobal("fetch", fetchMock);

    await voteOnProposal("7", true);
    await createGovernanceProposal({ changeType: "fee_rate", value: "300" });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/governance/proposals/7/votes"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ support: true }) }),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/governance/proposals"),
      expect.objectContaining({ body: JSON.stringify({ changeType: "fee_rate", value: "300" }) }),
    );
  });
});
