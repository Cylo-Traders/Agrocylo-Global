import { prisma } from '../config/database.js';
import { ApiError } from '../http/errors.js';
import { z } from 'zod';
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

export async function getProfile(wallet_address: string): Promise<ClientProfile> {
  const profile = await prisma.profile.findUnique({ where: { wallet_address } });
  if (!profile) {
    throw new ApiError(404, 'Not Found', 'Profile not found', 'https://cylos.io/errors/not-found');
  }
  return toClientProfile(profile);
}

export async function createProfile(walletAddress: string, body: unknown): Promise<ClientProfile> {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const name = pickProfileName(record);
  const roleRaw = typeof record['role'] === 'string' ? record['role'] : 'BUYER';
  const bio = typeof record['bio'] === 'string' ? record['bio'] : undefined;
  const avatarUrl =
    typeof record['avatar_url'] === 'string' ? record['avatar_url'] : undefined;

  if (!name) {
    throw new ApiError(400, 'Bad Request', 'display_name is required', 'https://cylos.io/errors/validation');
  }

  const existing = await prisma.profile.findUnique({ where: { wallet_address: walletAddress } });
  if (existing) {
    throw new ApiError(409, 'Conflict', 'Profile already exists', 'https://cylos.io/errors/conflict');
  }

  const profile = await prisma.profile.create({
    data: {
      wallet_address: walletAddress,
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
  if (requester !== wallet_address) {
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
    where: { wallet_address },
    data,
  });

  return toClientProfile(profile);
}
