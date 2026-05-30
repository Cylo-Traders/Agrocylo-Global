import type { Profile } from '@prisma/client';

export type ClientProfileRole = 'farmer' | 'buyer' | 'admin';
export type ServerProfileRole = 'FARMER' | 'BUYER' | 'ADMIN';

export interface ClientProfile {
  wallet_address: string;
  role: ClientProfileRole;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
}

export function toServerRole(role: string): ServerProfileRole {
  const normalized = role.trim().toUpperCase();
  if (normalized === 'FARMER') return 'FARMER';
  if (normalized === 'ADMIN') return 'ADMIN';
  return 'BUYER';
}

export function toClientRole(role: string): ClientProfileRole {
  const normalized = role.trim().toUpperCase();
  if (normalized === 'FARMER') return 'farmer';
  if (normalized === 'ADMIN') return 'admin';
  return 'buyer';
}

export function toClientProfile(profile: Profile): ClientProfile {
  return {
    wallet_address: profile.wallet_address,
    role: toClientRole(profile.role),
    display_name: profile.name ?? '',
    bio: profile.bio ?? null,
    avatar_url: profile.avatar_url ?? null,
  };
}

export function pickProfileName(body: Record<string, unknown>): string | undefined {
  const displayName = body['display_name'];
  if (typeof displayName === 'string' && displayName.trim()) {
    return displayName.trim();
  }
  const name = body['name'];
  if (typeof name === 'string' && name.trim()) {
    return name.trim();
  }
  return undefined;
}
