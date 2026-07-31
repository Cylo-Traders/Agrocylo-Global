import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));

vi.mock("@/lib/apiClient", () => ({
  default: { post: mockPost },
}));

import { consumeHandoffToken } from "@/lib/authHandoff";

describe("consumeHandoffToken (Issue #686)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the session on success", async () => {
    const session = {
      accessToken: "jwt",
      sessionToken: "session-id",
      walletAddress: "GDEPOSITOR",
      expiresAt: "2026-01-01T00:00:00.000Z",
    };
    mockPost.mockResolvedValueOnce(session);

    const result = await consumeHandoffToken("handoff-token");

    expect(result).toEqual(session);
    expect(mockPost).toHaveBeenCalledWith("/auth/handoff", { token: "handoff-token" });
  });

  it("returns null when the server rejects the token (forged/replayed/expired)", async () => {
    mockPost.mockRejectedValueOnce(new Error("401"));

    const result = await consumeHandoffToken("bad-token");

    expect(result).toBeNull();
  });
});
