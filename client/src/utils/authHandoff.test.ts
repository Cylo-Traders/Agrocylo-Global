import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApiPost } = vi.hoisted(() => ({ mockApiPost: vi.fn() }));

vi.mock("@/lib/apiHelper", () => ({ apiPost: mockApiPost }));

const { generateHandoffToken, buildHandoffUrl } = await import("./authHandoff");

describe("authHandoff (Issue #686)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateHandoffToken", () => {
    it("returns the server-signed token on success", async () => {
      mockApiPost.mockResolvedValueOnce({ token: "signed.jwt.token" });
      const token = await generateHandoffToken();
      expect(token).toBe("signed.jwt.token");
      expect(mockApiPost).toHaveBeenCalledWith("/auth/handoff", {});
    });

    it("returns null when the request fails (e.g. unauthenticated)", async () => {
      mockApiPost.mockRejectedValueOnce(new Error("401"));
      const token = await generateHandoffToken();
      expect(token).toBeNull();
    });
  });

  describe("buildHandoffUrl", () => {
    it("appends the token as a query param", () => {
      const url = buildHandoffUrl("https://agro.example.com", "abc.def.ghi");
      expect(url).toBe("https://agro.example.com/?handoff=abc.def.ghi");
    });

    it("returns the base URL unchanged when there is no token", () => {
      const url = buildHandoffUrl("https://agro.example.com", null);
      expect(url).toBe("https://agro.example.com");
    });

    it("returns the base URL unchanged for an invalid URL", () => {
      const url = buildHandoffUrl("not-a-url", "abc.def.ghi");
      expect(url).toBe("not-a-url");
    });
  });
});
