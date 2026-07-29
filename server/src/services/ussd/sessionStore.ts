import { prisma } from "../../config/database.js";

export interface UssdSessionData {
  id: string;
  sessionId: string;
  phoneNumber: string;
  step: string;
  state: Record<string, unknown>;
  walletAddress: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SESSION_TTL_MS = 10 * 60 * 1000;

export async function getSession(sessionId: string): Promise<UssdSessionData | null> {
  const session = await prisma.ussdSession.findUnique({ where: { sessionId } });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.ussdSession.delete({ where: { id: session.id } });
    return null;
  }
  return session as unknown as UssdSessionData;
}

export async function createSession(
  sessionId: string,
  phoneNumber: string,
  initialStep = "main_menu",
): Promise<UssdSessionData> {
  const session = await prisma.ussdSession.create({
    data: {
      sessionId,
      phoneNumber,
      step: initialStep,
      state: {},
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return session as unknown as UssdSessionData;
}

export async function updateSession(
  sessionId: string,
  data: { step?: string; state?: Record<string, unknown>; walletAddress?: string | null },
): Promise<UssdSessionData> {
  const updateData: Record<string, unknown> = {};
  if (data.step !== undefined) updateData.step = data.step;
  if (data.state !== undefined) updateData.state = data.state;
  if (data.walletAddress !== undefined) updateData.walletAddress = data.walletAddress;
  updateData.expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const session = await prisma.ussdSession.update({
    where: { sessionId },
    data: updateData,
  });
  return session as unknown as UssdSessionData;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await prisma.ussdSession.delete({ where: { sessionId } }).catch(() => {});
}

export async function getWalletByPhone(phoneNumber: string): Promise<string | null> {
  const link = await prisma.phoneLink.findUnique({ where: { phoneNumber } });
  return link?.walletAddress ?? null;
}

export async function getPhoneByWallet(walletAddress: string): Promise<string | null> {
  const link = await prisma.phoneLink.findFirst({ where: { walletAddress } });
  return link?.phoneNumber ?? null;
}

export async function linkPhoneToWallet(
  phoneNumber: string,
  walletAddress: string,
): Promise<void> {
  await prisma.phoneLink.upsert({
    where: { phoneNumber },
    create: { phoneNumber, walletAddress },
    update: { walletAddress },
  });
}
