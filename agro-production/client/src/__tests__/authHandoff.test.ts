import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));

vi.mock("@/lib/apiClient", () => ({
  default: { post: mockPost },
}));

import { consumeHandoffToken } from "@/lib/authHandoff";
import { runWithCartIntent } from "@/lib/cartIntent";

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

describe("wallet session states (Issue #1379)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("connected-but-unauthenticated: handshake succeeds and yields a session without a signature prompt", async () => {
    const session = {
      accessToken: "jwt",
      sessionToken: "session-id",
      walletAddress: "GCONNECTED",
      expiresAt: "2026-01-01T00:00:00.000Z",
    };
    mockPost.mockResolvedValueOnce(session);

    const result = await consumeHandoffToken("handoff-token");

    expect(result).toEqual(session);
    expect(result?.walletAddress).toBe("GCONNECTED");
  });

  it("authenticated: an existing session is returned and no extra handshake is attempted", async () => {
    const session = {
      accessToken: "jwt",
      sessionToken: "session-id",
      walletAddress: "GAUTHED",
      expiresAt: "2026-01-01T00:00:00.000Z",
    };
    mockPost.mockResolvedValueOnce(session);

    const result = await consumeHandoffToken("handoff-token");

    expect(result).toEqual(session);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it("expired-session: a rejected handshake returns null so the UI can prompt to finish signing in", async () => {
    mockPost.mockRejectedValueOnce(new Error("401"));

    const result = await consumeHandoffToken("expired-token");

    expect(result).toBeNull();
  });

  it("transient API outage: a network error does not fabricate a session or a signature prompt", async () => {
    mockPost.mockRejectedValueOnce(new Error("Network Error"));

    const result = await consumeHandoffToken("handoff-token");

    expect(result).toBeNull();
  });
});
