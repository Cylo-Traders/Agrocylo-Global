import type { ProvenanceRecord } from "@/types/provenance";
import { EMPTY_PROVENANCE_MILESTONES } from "@/types/provenance";
import { apiRequest } from "@/lib/apiHelper";

function publicBaseUrl(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://agrocylo.app";
}

/**
 * Fetch supply-chain provenance for an order or product.
 * Falls back cleanly when the backend has no provenance data yet.
 */
export async function fetchOrderProvenance(
  orderId: string,
): Promise<ProvenanceRecord> {
  try {
    const data = await apiRequest<Partial<ProvenanceRecord>>(
      `/orders/${orderId}/provenance`,
    );
    return normalizeProvenance(data, { orderId });
  } catch {
    return untrackedProvenance({ orderId });
  }
}

export interface ProductProvenanceResult {
  record: ProvenanceRecord | null;
  error: unknown | null;
}

export async function fetchProductProvenanceWithError(
  productId: string,
): Promise<ProductProvenanceResult> {
  try {
    const data = await apiRequest<Partial<ProvenanceRecord>>(
      `/products/${productId}/provenance`,
    );
    return { record: normalizeProvenance(data, { productId }), error: null };
  } catch (error) {
    return { record: null, error };
  }
}

export async function fetchProductProvenance(
  productId: string,
): Promise<ProvenanceRecord> {
  const { record } = await fetchProductProvenanceWithError(productId);
  return record ?? untrackedProvenance({ productId });
}

function untrackedProvenance(ids: {
  orderId?: string;
  productId?: string;
}): ProvenanceRecord {
  const path = ids.orderId
    ? `/orders/${ids.orderId}`
    : `/market/${ids.productId}`;
  return {
    ...ids,
    farmerAddress: null,
    farmerName: null,
    batchId: null,
    harvestDate: null,
    originLocation: null,
    milestones: EMPTY_PROVENANCE_MILESTONES,
    shareUrl: `${publicBaseUrl()}${path}`,
    tracked: false,
  };
}

function normalizeProvenance(
  data: Partial<ProvenanceRecord>,
  ids: { orderId?: string; productId?: string },
): ProvenanceRecord {
  const path = ids.orderId
    ? `/orders/${ids.orderId}`
    : `/market/${ids.productId}`;
  const tracked = Boolean(
    data.tracked ??
      data.batchId ??
      data.harvestDate ??
      (data.milestones && data.milestones.length > 0),
  );

  return {
    orderId: data.orderId ?? ids.orderId,
    productId: data.productId ?? ids.productId,
    farmerAddress: data.farmerAddress ?? null,
    farmerName: data.farmerName ?? null,
    batchId: data.batchId ?? null,
    harvestDate: data.harvestDate ?? null,
    originLocation: data.originLocation ?? null,
    milestones:
      data.milestones && data.milestones.length > 0
        ? data.milestones
        : EMPTY_PROVENANCE_MILESTONES,
    shareUrl: data.shareUrl ?? `${publicBaseUrl()}${path}`,
    tracked,
  };
}
