import { describe, expect, it, vi } from "vitest";
import { apiBaseUrl } from "./apiConfig";
import { ApiClient } from "./apiClient";

describe("production API configuration", () => {
  it.each([undefined, "", "http://localhost:3001", "https://api.example.com", "https://api.example.com/api/v1?token=x"])(
    "rejects missing or incorrectly mounted endpoints: %s", (value) => {
      expect(() => apiBaseUrl(value)).toThrow();
    },
  );

  it("keeps the API mount when requesting campaigns", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const api = new ApiClient({ baseUrl: apiBaseUrl("http://localhost:5001/api/v1/"), fetchImpl });
    await api.get("/campaigns", { auth: false });
    expect(fetchImpl.mock.calls[0][0]).toBe("http://localhost:5001/api/v1/campaigns");
  });
});
