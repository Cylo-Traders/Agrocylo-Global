import { prisma } from '../config/database.js';
import { ApiError } from '../http/errors.js';
import { z } from 'zod';
import { getReputationSnapshot } from './reputationService.js';
import { listReviewsForSubject } from './reviewService.js';
import {
  pickProfileName,
  toClientProfile,
  toServerRole,
  type ClientProfile,
} from '../lib/profileDto.js';

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  display_name: z.string().min(1).max(100).optional(),
  bio: z.string().max(500).optional().nullable(),
  avatar_url: z.string().url().optional().nullable(),
});

/**
 * Profiles are keyed by the canonical (lower-cased) wallet address — the same
 * form IdentityService writes on sign-in. Every entry point below canonicalizes
 * so a checksummed caller address (G… vs g…) hits the same row instead of
 * missing it (404) or violating the users FK on create (#1185).
 */
function canonicalWallet(wallet_address: string): string {
  return wallet_address.trim().toLowerCase();
}

export async function getProfile(wallet_address: string): Promise<ClientProfile> {
  const profile = await prisma.profile.findUnique({
    where: { walletAddress: canonicalWallet(wallet_address) },
  });
  if (!profile) {
    throw new ApiError(404, 'Not Found', 'Profile not found', 'https://cylos.io/errors/not-found');
  }
  return toClientProfile(profile);
}

export async function createProfile(walletAddress: string, body: unknown): Promise<ClientProfile> {
  const canonical = canonicalWallet(walletAddress);
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const name = pickProfileName(record);
  const roleRaw = typeof record['role'] === 'string' ? record['role'] : 'BUYER';
  const bio = typeof record['bio'] === 'string' ? record['bio'] : undefined;
  const avatarUrl =
    typeof record['avatar_url'] === 'string' ? record['avatar_url'] : undefined;

  if (!name) {
    throw new ApiError(400, 'Bad Request', 'display_name is required', 'https://cylos.io/errors/validation');
  }

  const existing = await prisma.profile.findUnique({ where: { walletAddress: canonical } });
  if (existing) {
    // Sign-in already creates a default BUYER profile (IdentityService), so
    // the onboarding POST arrives with the profile present. Apply the chosen
    // name/bio/avatar plus a one-time BUYER → chosen-role upgrade instead of
    // rejecting with 409 — otherwise a farmer can never leave the default
    // BUYER role and the dashboard AuthGuard bounces them (#1185).
    // ADMIN is never assignable through this path (no privilege escalation).
    const requestedRole = toServerRole(roleRaw);
    const data: { name?: string; bio?: string; avatar_url?: string; role?: string } = {};
    if (name) data.name = name;
    if (bio !== undefined) data.bio = bio;
    if (avatarUrl !== undefined) data.avatar_url = avatarUrl;
    if (existing.role === 'BUYER' && requestedRole !== 'ADMIN') {
      data.role = requestedRole;
    }
    if (Object.keys(data).length === 0) {
      return toClientProfile(existing);
    }
    const updated = await prisma.profile.update({
      where: { walletAddress: canonical },
      data,
    });
    return toClientProfile(updated);
  }

  const profile = await prisma.profile.create({
    data: {
      walletAddress: canonical,
      name,
      bio: bio ?? null,
      avatar_url: avatarUrl ?? null,
      role: toServerRole(roleRaw),
    },
  });

  return toClientProfile(profile);
}

export async function updateProfile(
  wallet_address: string,
  requester: string,
  body: unknown,
): Promise<ClientProfile> {
  const target = canonicalWallet(wallet_address);
  if (canonicalWallet(requester) !== target) {
    throw new ApiError(403, 'Forbidden', 'You can only update your own profile', 'https://cylos.io/errors/forbidden');
  }

  const parsed = updateProfileSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ApiError(400, 'Bad Request', parsed.error.message, 'https://cylos.io/errors/validation');
  }

  const data: { name?: string; bio?: string | null; avatar_url?: string | null } = {};
  const displayName = parsed.data.display_name ?? parsed.data.name;
  if (displayName !== undefined) data.name = displayName;
  if (parsed.data.bio !== undefined) data.bio = parsed.data.bio;
  if (parsed.data.avatar_url !== undefined) data.avatar_url = parsed.data.avatar_url;

  if (Object.keys(data).length === 0) {
    throw new ApiError(400, 'Bad Request', 'No valid fields to update', 'https://cylos.io/errors/validation');
  }

  const profile = await prisma.profile.update({
    where: { walletAddress: target },
    data,
  });

  return toClientProfile(profile);
}

export async function getProfileReputation(wallet_address: string) {
  const canonical = canonicalWallet(wallet_address);
  const profile = await prisma.profile.findUnique({ where: { walletAddress: canonical } });
  if (!profile) {
    throw new ApiError(404, 'Not Found', 'Profile not found', 'https://cylos.io/errors/not-found');
  }

  return getReputationSnapshot(canonical);
}

export async function getProfileGraphData(wallet_address: string) {
  const canonical = canonicalWallet(wallet_address);
  const profile = await prisma.profile.findUnique({ where: { walletAddress: canonical } });
  if (!profile) {
    throw new ApiError(404, 'Not Found', 'Profile not found', 'https://cylos.io/errors/not-found');
  }

  const [reputation, reviews] = await Promise.all([
    getReputationSnapshot(canonical),
    listReviewsForSubject(canonical),
  ]);

  return {
    profile: toClientProfile(profile),
    reputation,
    reviews,
  };
}
