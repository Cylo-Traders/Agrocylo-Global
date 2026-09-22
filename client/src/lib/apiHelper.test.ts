import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  apiRequest,
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
  ApiRequestError,
} from "./apiHelper";
import * as authTokenModule from "./authToken";

vi.mock("./apiConfig", () => ({
  API_BASE_URL: "https://api.agrocylo.example.com",
}));

describe("apiHelper - apiRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("server error code preservation (Issue #930)", () => {
    it("preserves HTTP 403 with code FORBIDDEN instead of rewriting to NOT_FOUND", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "FORBIDDEN", message: "Access denied" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(apiRequest("/secure-resource")).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(ApiRequestError);
          const apiErr = err as ApiRequestError;
          expect(apiErr.code).toBe("FORBIDDEN");
          expect(apiErr.status).toBe(403);
          expect(apiErr.message).toBe("Access denied");
          expect(apiErr.details).toEqual({
            code: "FORBIDDEN",
            message: "Access denied",
          });
          return true;
        },
      );
    });

    it("preserves representative validation error codes and structured details", async () => {
      const details = {
        code: "VALIDATION_FAILED",
        message: "Invalid order parameters",
        fields: [{ name: "quantity", error: "Must be positive" }],
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(details), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(apiRequest("/orders", { method: "POST" })).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(ApiRequestError);
          const apiErr = err as ApiRequestError;
          expect(apiErr.code).toBe("VALIDATION_FAILED");
          expect(apiErr.status).toBe(422);
          expect(apiErr.message).toBe("Invalid order parameters");
          expect(apiErr.details).toEqual(details);
          return true;
        },
      );
    });

    it("preserves rate-limit error codes", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "RATE_LIMITED",
            message: "Too many requests. Please slow down.",
          }),
          {
            status: 429,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

      await expect(apiRequest("/rate-limited-endpoint")).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(ApiRequestError);
          const apiErr = err as ApiRequestError;
          expect(apiErr.code).toBe("RATE_LIMITED");
          expect(apiErr.status).toBe(429);
          return true;
        },
      );
    });

    it("preserves explicit server error codes on 404 responses if provided", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "PRODUCT_UNAVAILABLE",
            message: "Product was decommissioned",
          }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

      await expect(apiRequest("/products/999")).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(ApiRequestError);
          const apiErr = err as ApiRequestError;
          expect(apiErr.code).toBe("PRODUCT_UNAVAILABLE");
          expect(apiErr.status).toBe(404);
          expect(apiErr.message).toBe("Product was decommissioned");
          return true;
        },
      );
    });
  });

  describe("fallback error code behavior", () => {
    it("maps an uncoded 404 response to NOT_FOUND", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Entity not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(apiRequest("/missing")).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(ApiRequestError);
          const apiErr = err as ApiRequestError;
          expect(apiErr.code).toBe("NOT_FOUND");
          expect(apiErr.status).toBe(404);
          expect(apiErr.message).toBe("Entity not found");
          return true;
        },
      );
    });

    it("maps an uncoded 500 response to SERVER_ERROR", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Internal server error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(apiRequest("/faulty")).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(ApiRequestError);
          const apiErr = err as ApiRequestError;
          expect(apiErr.code).toBe("SERVER_ERROR");
          expect(apiErr.status).toBe(500);
          expect(apiErr.message).toBe("Internal server error");
          return true;
        },
      );
    });

    it("falls back to SERVER_ERROR on empty or whitespace-only code strings", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "   ", message: "Bad request" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(apiRequest("/bad-request")).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(ApiRequestError);
          const apiErr = err as ApiRequestError;
          expect(apiErr.code).toBe("SERVER_ERROR");
          expect(apiErr.status).toBe(400);
          return true;
        },
      );
    });

    it("falls back to NOT_FOUND on 404 when code is empty string", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "", message: "Nothing here" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(apiRequest("/empty-code-404")).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(ApiRequestError);
          const apiErr = err as ApiRequestError;
          expect(apiErr.code).toBe("NOT_FOUND");
          expect(apiErr.status).toBe(404);
          return true;
        },
      );
    });

    it("falls back to status-based code when code is a non-string type", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 50012, message: "Error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(apiRequest("/malformed-code-type")).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(ApiRequestError);
          const apiErr = err as ApiRequestError;
          expect(apiErr.code).toBe("SERVER_ERROR");
          expect(apiErr.status).toBe(500);
          return true;
        },
      );
    });
  });

  describe("malformed or non-JSON error responses", () => {
    it("handles non-JSON plain text 502 Bad Gateway response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("<html>502 Bad Gateway</html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        }),
      );

      await expect(apiRequest("/gateway")).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(ApiRequestError);
          const apiErr = err as ApiRequestError;
          expect(apiErr.code).toBe("SERVER_ERROR");
          expect(apiErr.status).toBe(502);
          expect(apiErr.message).toBe("Request failed with status 502");
          expect(apiErr.details).toBeNull();
          return true;
        },
      );
    });

    it("handles non-JSON 404 response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Not found", {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        }),
      );

      await expect(apiRequest("/plain-404")).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(ApiRequestError);
          const apiErr = err as ApiRequestError;
          expect(apiErr.code).toBe("NOT_FOUND");
          expect(apiErr.status).toBe(404);
          expect(apiErr.message).toBe("Request failed with status 404");
          expect(apiErr.details).toBeNull();
          return true;
        },
      );
    });
  });

  describe("message and title extraction", () => {
    it("extracts title when message is absent", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            title: "Resource Conflict",
            code: "CONFLICT",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      );

      await expect(apiRequest("/conflict")).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(ApiRequestError);
          const apiErr = err as ApiRequestError;
          expect(apiErr.code).toBe("CONFLICT");
          expect(apiErr.message).toBe("Resource Conflict");
          return true;
        },
      );
    });

    it("prefers message over title when both are present", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: "Detailed conflict description",
            title: "Conflict",
            code: "CONFLICT",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      );

      await expect(apiRequest("/conflict-both")).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(ApiRequestError);
          const apiErr = err as ApiRequestError;
          expect(apiErr.message).toBe("Detailed conflict description");
          return true;
        },
      );
    });
  });

  describe("successful requests and standard operations", () => {
    it("resolves JSON response on HTTP 200", async () => {
      const mockData = { id: "item-1", name: "Corn", price: 12.5 };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const result = await apiRequest<{ id: string; name: string; price: number }>("/items/item-1");
      expect(result).toEqual(mockData);
    });

    it("returns undefined on HTTP 204 No Content", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 204 }),
      );

      const result = await apiRequest("/items/item-1", { method: "DELETE" });
      expect(result).toBeUndefined();
    });

    it("includes Authorization bearer token when present", async () => {
      vi.spyOn(authTokenModule, "getAccessToken").mockReturnValue("test-jwt-token");
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await apiRequest("/authenticated-route");

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.agrocylo.example.com/authenticated-route",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-jwt-token",
          }),
        }),
      );
    });
  });

  describe("network failure and timeout handling", () => {
    it("converts network error to ApiRequestError with NETWORK_ERROR code", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));

      await expect(apiRequest("/network-fail")).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(ApiRequestError);
          const apiErr = err as ApiRequestError;
          expect(apiErr.code).toBe("NETWORK_ERROR");
          expect(apiErr.status).toBe(0);
          expect(apiErr.message).toBe("Failed to fetch");
          return true;
        },
      );
    });

    it("converts AbortError to ApiRequestError with TIMEOUT code", async () => {
      const abortError = new DOMException("The operation was aborted", "AbortError");
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortError);

      await expect(apiRequest("/slow-call", { timeout: 1000 })).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(ApiRequestError);
          const apiErr = err as ApiRequestError;
          expect(apiErr.code).toBe("TIMEOUT");
          expect(apiErr.status).toBe(0);
          expect(apiErr.message).toBe("Request timed out after 1000ms");
          return true;
        },
      );
    });
  });

  describe("convenience wrappers (apiGet, apiPost, apiPut, apiPatch, apiDelete)", () => {
    it("apiGet passes GET method and wallet header when provided", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ data: "get-result" }), { status: 200 }),
      );

      const res = await apiGet("/wallet-data", "GA123...");
      expect(res).toEqual({ data: "get-result" });
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.agrocylo.example.com/wallet-data",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "x-wallet-address": "GA123...",
          }),
        }),
      );
    });

    it("apiPost sends stringified JSON body and POST method", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "created" }), { status: 201 }),
      );

      const res = await apiPost("/items", { name: "Wheat" }, "GA123...");
      expect(res).toEqual({ id: "created" });
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.agrocylo.example.com/items",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "Wheat" }),
          headers: expect.objectContaining({
            "x-wallet-address": "GA123...",
          }),
        }),
      );
    });

    it("apiPut sends PUT method with payload", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ updated: true }), { status: 200 }),
      );

      const res = await apiPut("/items/1", { name: "Barley" });
      expect(res).toEqual({ updated: true });
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.agrocylo.example.com/items/1",
        expect.objectContaining({ method: "PUT" }),
      );
    });

    it("apiPatch sends PATCH method with payload", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ patched: true }), { status: 200 }),
      );

      const res = await apiPatch("/items/1", { status: "ACTIVE" });
      expect(res).toEqual({ patched: true });
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.agrocylo.example.com/items/1",
        expect.objectContaining({ method: "PATCH" }),
      );
    });

    it("apiDelete sends DELETE method", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 204 }),
      );

      await apiDelete("/items/1", "GA123...");
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.agrocylo.example.com/items/1",
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            "x-wallet-address": "GA123...",
          }),
        }),
      );
    });
  });
});
