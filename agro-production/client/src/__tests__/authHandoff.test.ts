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

describe("cart intent resume after sign-in (Issue #1391)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not run the cart action until a session is present", async () => {
    const action = vi.fn().mockResolvedValue(undefined);

    const result = await runWithCartIntent({ hasSession: false, action });

    expect(result).toEqual({ status: "needs-signin" });
    expect(action).not.toHaveBeenCalled();
  });

  it("resumes the preserved cart action exactly once after sign-in", async () => {
    const action = vi.fn().mockResolvedValue(undefined);

    const result = await runWithCartIntent({ hasSession: true, action });

    expect(result).toEqual({ status: "done" });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate the cart action when the session is recovered", async () => {
    const action = vi.fn().mockResolvedValue(undefined);

    const first = await runWithCartIntent({ hasSession: false, action });
    const second = await runWithCartIntent({ hasSession: true, action });

    expect(first).toEqual({ status: "needs-signin" });
    expect(second).toEqual({ status: "done" });
    expect(action).toHaveBeenCalledTimes(1);
  });
});
