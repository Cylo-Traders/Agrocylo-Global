import type { BarterOffer, BarterOfferInput } from "@/types/barter";
import { API_BASE_URL } from "@/lib/apiConfig";

export async function createBarterOffer(payload: BarterOfferInput): Promise<BarterOffer> {
  const res = await fetch(`${API_BASE_URL}/barter`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Failed to create barter offer: ${res.status}`);
  }
  return res.json();
}

export async function listBarterOffers(): Promise<BarterOffer[]> {
  const res = await fetch(`${API_BASE_URL}/barter`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch barter offers: ${res.status}`);
  }
  return res.json();
}

export async function acceptBarterOffer(offerId: string): Promise<BarterOffer> {
  const res = await fetch(`${API_BASE_URL}/barter/${offerId}/accept`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to accept barter offer: ${res.status}`);
  }
  return res.json();
}

export async function rejectBarterOffer(offerId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/barter/${offerId}/reject`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to reject barter offer: ${res.status}`);
  }
}

export async function expireBarterOffer(offerId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/barter/${offerId}/expire`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to expire barter offer: ${res.status}`);
  }
}
