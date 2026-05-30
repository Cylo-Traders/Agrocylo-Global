import { API_BASE_URL as API_BASE } from "@/lib/apiConfig";
import { isTestMode } from "@/lib/testMode";
import type { ProfileRole } from "@/types/wallet";

export interface Profile {
  wallet_address: string;
  role: ProfileRole;
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

export interface ProfileUpdateInput {
  display_name?: string;
  bio?: string | null;
  avatar_url?: string | null;
}

function mapProfile(raw: Record<string, unknown>): Profile {
  const roleRaw = typeof raw.role === "string" ? raw.role : "buyer";
  const role = roleRaw.toLowerCase() as ProfileRole;

  return {
    wallet_address: String(raw.wallet_address ?? raw.walletAddress ?? ""),
    role: role === "admin" || role === "farmer" ? role : "buyer",
    display_name: String(raw.display_name ?? raw.name ?? ""),
    bio: raw.bio == null ? null : String(raw.bio),
    avatar_url: raw.avatar_url == null ? null : String(raw.avatar_url),
  };
}

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.detail ?? body?.message ?? body?.title ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export async function getProfile(wallet: string): Promise<Profile | null> {
  if (isTestMode()) {
    return {
      wallet_address: wallet,
      role: "farmer",
      display_name: "Test Farmer",
      bio: null,
      avatar_url: null,
    };
  }

  const res = await fetch(`${API_BASE}/profiles/${encodeURIComponent(wallet)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const data = (await res.json()) as Record<string, unknown>;
  return mapProfile(data);
}

export async function createProfile(
  data: {
    role: ProfileRole;
    display_name: string;
    bio?: string;
    avatar_url?: string;
  },
  walletAddress: string,
): Promise<Profile> {
  if (isTestMode()) {
    return {
      wallet_address: walletAddress,
      role: data.role,
      display_name: data.display_name,
      bio: data.bio ?? null,
      avatar_url: data.avatar_url ?? null,
    };
  }

  const res = await fetch(`${API_BASE}/profiles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wallet-address": walletAddress,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const body = (await res.json()) as Record<string, unknown>;
  return mapProfile(body);
}

export async function updateProfile(
  walletAddress: string,
  data: ProfileUpdateInput,
): Promise<Profile> {
  if (isTestMode()) {
    const existing = await getProfile(walletAddress);
    return {
      wallet_address: walletAddress,
      role: existing?.role ?? "farmer",
      display_name: data.display_name ?? existing?.display_name ?? "Test Farmer",
      bio: data.bio !== undefined ? data.bio : (existing?.bio ?? null),
      avatar_url:
        data.avatar_url !== undefined
          ? data.avatar_url
          : (existing?.avatar_url ?? null),
    };
  }

  const res = await fetch(
    `${API_BASE}/profiles/${encodeURIComponent(walletAddress)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-wallet-address": walletAddress,
      },
      body: JSON.stringify(data),
    },
  );
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const body = (await res.json()) as Record<string, unknown>;
  return mapProfile(body);
}

export async function registerLocation(
  data: LocationData,
  walletAddress: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/locations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wallet-address": walletAddress,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to register location: ${res.status}`);
}
