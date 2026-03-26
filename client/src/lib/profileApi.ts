const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

export interface Profile {
  wallet_address: string;
  role: "farmer" | "buyer";
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
}

export interface LocationData {
  latitude: number;
  longitude: number;
  city: string | null;
  country: string | null;
  is_public: boolean;
}

export async function getProfile(wallet: string): Promise<Profile | null> {
  const res = await fetch(`${API_BASE}/profile/${encodeURIComponent(wallet)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch profile: ${res.status}`);
  return res.json();
}

export async function createProfile(data: {
  role: "farmer" | "buyer";
  display_name: string;
  bio?: string;
  avatar_url?: string;
}, walletAddress: string): Promise<Profile> {
  const res = await fetch(`${API_BASE}/profile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wallet-address": walletAddress,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to create profile: ${res.status}`);
  return res.json();
}

export async function registerLocation(
  data: LocationData,
  walletAddress: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/location`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wallet-address": walletAddress,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to register location: ${res.status}`);
}
