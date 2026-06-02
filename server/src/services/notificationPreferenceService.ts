import { prisma } from '../config/database.js';
import { z } from 'zod';

export const notificationPrefsSchema = z.object({
  types: z.object({
    orders: z.boolean(),
    disputes: z.boolean(),
    priceAlerts: z.boolean(),
    system: z.boolean(),
    demandSignals: z.boolean(),
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
  const parsed = notificationPrefsSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(parsed.error.message);
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
}
