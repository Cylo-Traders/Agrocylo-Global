import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { setAccessToken } from "@/lib/authToken";

// Capture the fetch inputs the ApiClient issues, with the real client (no
// mocks) so the auth header and multipart field are verified end to end.
const fetchMock = vi.fn();

import {
  uploadCampaignImage,
  saveRetryState,
  loadRetryState,
  clearRetryState,
} from "@/services/campaignImageService";

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Map([["content-type", "application/json"]]),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function errorJson(status: number, body: unknown) {
  return {
    ok: false,
    status,
    statusText: "err",
    headers: new Map([["content-type", "application/json"]]),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function fakeFile(): File {
  return new File([Buffer.from("fake-image-data")], "cover.jpg", { type: "image/jpeg" });
}

describe("campaignImageService (#1053)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    setAccessToken("session-token");
    sessionStorage.clear();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    sessionStorage.clear();
  });

  it("uploads multipart field 'image' to the configured base with auth", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ image_url: "https://cdn/campaign.webp" }));

    const state = await uploadCampaignImage("00000000-0000-0000-0000-000000000001", fakeFile());

    expect(state).toEqual({ kind: "uploaded", imageUrl: "https://cdn/campaign.webp" });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain("/campaigns/00000000-0000-0000-0000-000000000001/image");

    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer session-token");
    // The browser must set the multipart boundary itself.
    expect(headers["Content-Type"]).toBeUndefined();

    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("image")).toBeInstanceOf(File);
  });

  it("maps a 401 rejection to the unauthorized state", async () => {
    fetchMock.mockResolvedValueOnce(errorJson(401, { message: "Unauthorized." }));

    await expect(uploadCampaignImage("c-1", fakeFile())).resolves.toEqual({
      kind: "unauthorized",
    });
  });

  it("maps 400/415 rejections to the media state", async () => {
    fetchMock.mockResolvedValueOnce(errorJson(400, { message: "Missing or unsupported image." }));
    await expect(uploadCampaignImage("c-1", fakeFile())).resolves.toEqual({
      kind: "unsupported_media",
    });

    fetchMock.mockResolvedValueOnce(errorJson(415, { message: "Unsupported Media Type." }));
    await expect(uploadCampaignImage("c-1", fakeFile())).resolves.toEqual({
      kind: "unsupported_media",
    });
  });

  it("maps a 413 rejection to the size state", async () => {
    fetchMock.mockResolvedValueOnce(errorJson(413, { message: "Payload too large." }));

    await expect(uploadCampaignImage("c-1", fakeFile())).resolves.toEqual({
      kind: "too_large",
    });
  });

  it("maps connection failures to the offline state", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(uploadCampaignImage("c-1", fakeFile())).resolves.toEqual({
      kind: "offline",
    });
  });

  it("does not implicitly retry a failed upload", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await uploadCampaignImage("c-1", fakeFile());

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("persists and clears retry state across reloads", () => {
    saveRetryState({
      campaignId: "c-1",
      fileName: "cover.jpg",
      fileSize: 123,
      createdAt: 1,
    });

    expect(loadRetryState()).toMatchObject({ campaignId: "c-1", fileName: "cover.jpg" });

    clearRetryState();
    expect(loadRetryState()).toBeNull();
  });
});
