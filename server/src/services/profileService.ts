import prisma from '../config/database.js';
import { ApiError } from '../http/errors.js';
import { z } from 'zod';

const createProfileSchema = z.object({
  wallet_address: z.string().min(1),
  name: z.string().optional(),
  bio: z.string().optional(),
  avatar_url: z.string().url().optional(),
  role: z.enum(['FARMER', 'BUYER']).default('BUYER'),
});

const updateProfileSchema = z.object({
  name: z.string().optional(),
  bio: z.string().optional(),
  avatar_url: z.string().url().optional(),
});

export async function getProfile(wallet_address: string) {
  const profile = await prisma.profile.findUnique({ where: { wallet_address } });
  if (!profile) throw new ApiError(404, 'Not Found', 'Profile not found', 'https://cylos.io/errors/not-found');
  return profile;
}

export async function createProfile(walletAddress: string, body: unknown) {
  const parsed = createProfileSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, 'Bad Request', parsed.error.message, 'https://cylos.io/errors/validation');
  if (parsed.data.wallet_address !== walletAddress) {
    throw new ApiError(403, 'Forbidden', 'Cannot create profile for another wallet', 'https://cylos.io/errors/forbidden');
  }
  const existing = await prisma.profile.findUnique({ where: { wallet_address: walletAddress } });
  if (existing) throw new ApiError(409, 'Conflict', 'Profile already exists', 'https://cylos.io/errors/conflict');
  return prisma.profile.create({ data: parsed.data });
}

export async function updateProfile(wallet_address: string, requester: string, body: unknown) {
  if (requester !== wallet_address) {
    throw new ApiError(403, 'Forbidden', 'You can only update your own profile', 'https://cylos.io/errors/forbidden');
  }
  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, 'Bad Request', parsed.error.message, 'https://cylos.io/errors/validation');
  return prisma.profile.update({ where: { wallet_address }, data: parsed.data });
}
