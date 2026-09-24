import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, apiRequest } from "./apiHelper";
import {
  AUTH_EXPIRED_EVENT,
  getAccessToken,
  setAuthSession,
} from "./authToken";

describe("apiRequest error classification", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["FORBIDDEN", "VALIDATION_ERROR", "RATE_LIMITED"])(
    "preserves the explicit %s server code",
    async (code) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({ code, message: "Denied", field: "name" }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      );

      await expect(apiRequest("/protected")).rejects.toMatchObject({
        code,
        status: 403,
        message: "Denied",
        details: { code, message: "Denied", field: "name" },
      });
    },
  );

  it("maps an uncoded 404 to NOT_FOUND", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("missing", { status: 404 })),
    );
    await expect(apiRequest("/missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("uses SERVER_ERROR for malformed, uncoded non-404 responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json", { status: 500 })),
    );
    const error = await apiRequest("/broken").catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ code: "SERVER_ERROR", status: 500 });
  });

  it("keeps successful JSON and 204 behavior", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiRequest("/ok")).resolves.toEqual({ ok: true });
    await expect(apiRequest("/empty")).resolves.toBeUndefined();
  });

  it("authenticates protected requests and clears an expired session on 401", async () => {
    setAuthSession("GWALLET", "signed-jwt", "refresh-jwt");
    const expired = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, expired, { once: true });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "UNAUTHORIZED" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/cart")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer signed-jwt",
    });
    expect(getAccessToken()).toBeNull();
    expect(expired).toHaveBeenCalledOnce();
  });
});
