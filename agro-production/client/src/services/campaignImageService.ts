/**
 * Campaign image upload service (Issue #1053)
 *
 * Uploads through the configured, authenticated API base:
 *   POST {API}/campaigns/:campaignId/image
 *     - multipart field: "image" (jpg / png / webp, enforced server-side)
 *     - Authorization: Bearer <wallet session token> via ApiClient
 *
 * The endpoint is registered without the /api/v1 prefix on the server
 * (ROUTES.md), so the path here is "/campaigns/:id/image" relative to the
 * API root — the server mounts this router at the app root.
 *
 * Upload is a retryable POST-CREATION phase: the campaign already exists,
 * so a failure never recreates it. `retryCampaignImageUpload` persists the
 * minimal retry state in sessionStorage (survives a reload of the page in
 * the same tab) and the UI offers Retry / Skip with a partial-success note.
 */

import api from "../lib/apiClient";
import { isApiError, isNetworkError } from "../lib/apiClient";

const RETRY_STATE_KEY = "ap:campaign-image-retry";

export interface CampaignImageRetryState {
  campaignId: string;
  /** Dehydrated file metadata so the UI can show what is pending. */
  fileName: string;
  fileSize: number;
  createdAt: number;
}

export type CampaignImageUploadState =
  | { kind: "uploaded"; imageUrl: string }
  | { kind: "skipped" }
  | { kind: "unauthorized" }
  | { kind: "unsupported_media" }
  | { kind: "too_large" }
  | { kind: "offline" }
  | { kind: "error"; message: string };

/** Persist retry state across reloads of the creation flow. */
export function saveRetryState(state: CampaignImageRetryState): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(RETRY_STATE_KEY, JSON.stringify(state));
}

export function loadRetryState(): CampaignImageRetryState | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(RETRY_STATE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as CampaignImageRetryState).campaignId === "string"
    ) {
      return parsed as CampaignImageRetryState;
    }
  } catch {
    window.sessionStorage.removeItem(RETRY_STATE_KEY);
  }
  return null;
}

export function clearRetryState(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(RETRY_STATE_KEY);
}

function classifyUploadError(err: unknown): CampaignImageUploadState {
  if (isApiError(err)) {
    if (err.status === 401) return { kind: "unauthorized" };
    if (err.status === 415) return { kind: "unsupported_media" };
    if (err.status === 413) return { kind: "too_large" };
    if (err.status === 400) return { kind: "unsupported_media" };
  }
  if (isNetworkError(err)) return { kind: "offline" };
  return {
    kind: "error",
    message: err instanceof Error ? err.message : "Image upload failed",
  };
}

/**
 * Upload one attempt. Server failures map onto the documented states;
 * nothing is retried implicitly (the user decides Retry / Skip).
 */
export async function uploadCampaignImage(
  campaignId: string,
  file: File,
): Promise<CampaignImageUploadState> {
  const sanitizedId = campaignId.replace(/[^a-zA-Z0-9-]/g, "");

  try {
    const formData = new FormData();
    formData.append("image", file);

    const result = await api.upload<{ image_url: string }>(
      `/campaigns/${encodeURIComponent(sanitizedId)}/image`,
      formData,
      { retries: 0 },
    );

    return { kind: "uploaded", imageUrl: result.image_url };
  } catch (err) {
    return classifyUploadError(err);
  }
}
