import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ApiClient, ApiError, isApiError, isNetworkError } from "./apiClient";
import { getAccessToken, setAccessToken, AUTH_TOKEN_STORAGE_KEY } from "./authToken";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ApiClient 401 handling (#1255)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    setAccessToken("test-bearer-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("clears stored token, dispatches agrocylo:session-expired, and throws original ApiError on 401", async () => {
    const expiredHandler = vi.fn();
    window.addEventListener("agrocylo:session-expired", expiredHandler);

    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse(401, { error: "Token expired or invalid" }),
    );

    const client = new ApiClient({
      baseUrl: "https://api.example.com",
      fetchImpl: mockFetch as unknown as typeof fetch,
      defaultRetries: 2,
    });

    let thrownError: unknown;
    try {
      await client.get("/user/profile");
    } catch (err) {
      thrownError = err;
    }

    // 1. setAccessToken(null) cleared the token
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();

    // 2. Dispatched one session-expired event
    expect(expiredHandler).toHaveBeenCalledTimes(1);

    // 3. Original ApiError with status 401 reached caller
    expect(thrownError).toBeInstanceOf(ApiError);
    expect(isApiError(thrownError)).toBe(true);
    expect((thrownError as ApiError).status).toBe(401);
    expect((thrownError as ApiError).message).toBe("Token expired or invalid");

    // 4. Not reclassified as NetworkError
    expect(isNetworkError(thrownError)).toBe(false);

    // 5. 401 is not retried
    expect(mockFetch).toHaveBeenCalledTimes(1);

    window.removeEventListener("agrocylo:session-expired", expiredHandler);
  });
});
