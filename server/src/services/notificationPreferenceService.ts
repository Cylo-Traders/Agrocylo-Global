import { prisma } from '../config/database.js';
import { ApiError } from '../http/errors.js';
import logger from '../config/logger.js';
import { z } from 'zod';

export const notificationPrefsSchema = z.object({
  types: z.object({
    orders: z.boolean(),
    disputes: z.boolean(),
    priceAlerts: z.boolean(),
    system: z.boolean(),
    demandSignals: z.boolean(),
    weatherAlerts: z.boolean().default(true),
  }),
  delivery: z.object({
    toast: z.boolean(),
    email: z.boolean(),
    push: z.boolean(),
  }),
  sound: z.boolean(),
  quietHoursEnabled: z.boolean(),
  quietStart: z.string(),
  quietEnd: z.string(),
});

export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  types: {
    orders: true,
    disputes: true,
    priceAlerts: true,
    system: true,
    demandSignals: false,
    weatherAlerts: true,
  },
  delivery: {
    toast: true,
    email: false,
    push: false,
  },
  sound: true,
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '08:00',
};

export async function getNotificationPreferences(
  walletAddress: string,
): Promise<NotificationPrefs> {
  const row = await prisma.notificationPreference.findUnique({
    where: { walletAddress },
  });
  if (!row) return DEFAULT_NOTIFICATION_PREFS;

  const parsed = notificationPrefsSchema.safeParse(row.preferences);
  if (!parsed.success) return DEFAULT_NOTIFICATION_PREFS;
  return { ...DEFAULT_NOTIFICATION_PREFS, ...parsed.data };
}

export async function upsertNotificationPreferences(
  walletAddress: string,
  body: unknown,
): Promise<NotificationPrefs> {
  try {
    const parsed = notificationPrefsSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, 'Bad Request', parsed.error.message, 'https://cylos.io/errors/validation');
    }

    const row = await prisma.notificationPreference.upsert({
      where: { walletAddress },
      create: {
        walletAddress,
        preferences: parsed.data,
      },
      update: {
        preferences: parsed.data,
      },
    });

    return notificationPrefsSchema.parse(row.preferences);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logger.error('Failed to upsert notification preferences', { error, walletAddress });
    throw new ApiError(500, 'Internal Server Error', 'Failed to update notification preferences');
  }
}
