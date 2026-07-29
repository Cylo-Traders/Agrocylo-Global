import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getProfile, getUserProfile, updateProfile } from "./profileService";

describe("profileService", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("maps server profile fields on getProfile", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        wallet_address: "GTEST",
        name: "Green Valley Farm",
        role: "FARMER",
        bio: "Organic produce",
        avatar_url: null,
      }),
    } as Response);

    const profile = await getProfile("GTEST");
    expect(profile).toEqual({
      wallet_address: "GTEST",
      role: "farmer",
      display_name: "Green Valley Farm",
      bio: "Organic produce",
      avatar_url: null,
    });
  });

  it("updateProfile sends display_name and surfaces API errors", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: "display_name is required" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          wallet_address: "GTEST",
          display_name: "New Name",
          role: "farmer",
          bio: "Updated bio",
          avatar_url: null,
        }),
      } as Response);

    await expect(
      updateProfile("GTEST", { display_name: "" }),
    ).rejects.toThrow("display_name is required");

    const updated = await updateProfile("GTEST", {
      display_name: "New Name",
      bio: "Updated bio",
    });
    expect(updated.display_name).toBe("New Name");
    expect(updated.bio).toBe("Updated bio");
  });

  it("uses the backend-computed reputation score", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        score: 88,
        computedAt: "2026-07-27T00:00:00.000Z",
      }),
    } as Response);

    const profile = await getUserProfile("GKNOWN");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/profiles/GKNOWN/reputation"),
    );
    expect(profile.reputation.score).toBe(88);
    expect(profile.reputation.history).toEqual([
      expect.objectContaining({ score: 88, note: "Backend computed score" }),
    ]);
  });
});
