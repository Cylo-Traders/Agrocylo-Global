import { prisma } from "../config/database.js";
import logger from "../config/logger.js";
import { captureAlert } from "../config/sentry.js";
import { NotificationEventType } from "../enums/notificationEventType.js";
import { NotificationService } from "./notificationService.js";
import { getNotificationPreferences } from "./notificationPreferenceService.js";

/**
 * Normalized current-conditions reading, independent of the upstream weather
 * provider's response shape.
 */
export interface WeatherReading {
  temperatureC: number;
  precipitationMm: number;
  windSpeedKph: number;
  conditionCode: number;
  recordedAt: Date;
}

export interface WeatherAlert {
  severity: "watch" | "warning";
  condition: string;
}

/** Thresholds beyond which a farmer is alerted. Tunable without code changes elsewhere. */
export const WEATHER_THRESHOLDS = {
  heavyRainMm: 20,
  extremeRainMm: 50,
  highWindKph: 40,
  extremeWindKph: 70,
  frostC: 2,
  extremeHeatC: 40,
};

/**
 * Pure threshold evaluation: given a normalized reading, returns every alert that
 * applies (a single reading can trigger more than one, e.g. heavy rain + high wind).
 * No I/O, so this is fully unit-testable in isolation.
 */
export function evaluateThresholds(reading: WeatherReading): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];

  if (reading.precipitationMm >= WEATHER_THRESHOLDS.extremeRainMm) {
    alerts.push({ severity: "warning", condition: "Extreme rainfall" });
  } else if (reading.precipitationMm >= WEATHER_THRESHOLDS.heavyRainMm) {
    alerts.push({ severity: "watch", condition: "Heavy rainfall" });
  }

  if (reading.windSpeedKph >= WEATHER_THRESHOLDS.extremeWindKph) {
    alerts.push({ severity: "warning", condition: "Extreme wind" });
  } else if (reading.windSpeedKph >= WEATHER_THRESHOLDS.highWindKph) {
    alerts.push({ severity: "watch", condition: "High wind" });
  }

  if (reading.temperatureC <= WEATHER_THRESHOLDS.frostC) {
    alerts.push({ severity: "warning", condition: "Frost risk" });
  }

  if (reading.temperatureC >= WEATHER_THRESHOLDS.extremeHeatC) {
    alerts.push({ severity: "warning", condition: "Extreme heat" });
  }

  return alerts;
}

const WEATHER_API_BASE = "https://api.open-meteo.com/v1/forecast";

/**
 * Polls the public Open-Meteo API for current conditions at a location. No API key
 * required, which keeps this usable in every environment out of the box.
 */
export async function fetchCurrentWeather(
  lat: number,
  lng: number,
): Promise<{ reading: WeatherReading; raw: unknown }> {
  const url = `${WEATHER_API_BASE}?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,wind_speed_10m,weather_code`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Weather API request failed with status ${response.status}`);
  }
  const raw = await response.json();
  const current = (raw as Record<string, Record<string, number | string>>).current ?? {};

  return {
    raw,
    reading: {
      temperatureC: Number(current.temperature_2m ?? 0),
      precipitationMm: Number(current.precipitation ?? 0),
      windSpeedKph: Number(current.wind_speed_10m ?? 0),
      conditionCode: Number(current.weather_code ?? 0),
      recordedAt: current.time ? new Date(String(current.time)) : new Date(),
    },
  };
}

async function persistReading(
  walletAddress: string,
  location: { lat: number; lng: number },
  reading: WeatherReading,
  raw: unknown,
): Promise<void> {
  await prisma.weatherReading.create({
    data: {
      walletAddress,
      lat: location.lat,
      lng: location.lng,
      temperatureC: reading.temperatureC,
      precipitationMm: reading.precipitationMm,
      windSpeedKph: reading.windSpeedKph,
      conditionCode: reading.conditionCode,
      source: "open-meteo",
      rawPayload: raw as object,
      recordedAt: reading.recordedAt,
    },
  });
}

async function dispatchAlerts(
  walletAddress: string,
  alerts: WeatherAlert[],
): Promise<void> {
  if (alerts.length === 0) return;

  const prefs = await getNotificationPreferences(walletAddress);
  if (!prefs.types.weatherAlerts) return;

  await Promise.all(
    alerts.map((alert) =>
      NotificationService.notify({
        walletAddress,
        type: NotificationEventType.WEATHER_ALERT,
        condition: alert.condition,
        severity: alert.severity,
      }),
    ),
  );
}

/**
 * Fetches, persists, and (if thresholds are exceeded) alerts on current weather for
 * a single farmer's registered location.
 */
export async function pollFarmerWeather(walletAddress: string): Promise<void> {
  const location = await prisma.location.findUnique({ where: { walletAddress } });
  if (!location) return;

  const { reading, raw } = await fetchCurrentWeather(location.lat, location.lng);
  await persistReading(walletAddress, { lat: location.lat, lng: location.lng }, reading, raw);

  const alerts = evaluateThresholds(reading);
  await dispatchAlerts(walletAddress, alerts);
}

/**
 * Polls every registered farmer location. A single farmer's failure (bad
 * coordinates, upstream API hiccup) is logged and skipped rather than aborting the
 * whole batch.
 */
export async function pollAllFarmerLocations(): Promise<void> {
  const locations = await prisma.location.findMany({ select: { walletAddress: true } });

  for (const loc of locations as any[]) {
    const walletAddr = loc.walletAddress ?? loc.wallet_address;
    try {
      await pollFarmerWeather(walletAddr);
    } catch (error) {
      logger.error(`[weatherService] Failed to poll weather for ${walletAddr}`, error);
    }
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

/** Starts periodic polling of all farmer locations. Idempotent. */
export function startWeatherPolling(intervalMs = 60 * 60 * 1000): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    pollAllFarmerLocations().catch((error) => {
      logger.error("[weatherService] Polling cycle failed", error);
      // Issue #756: this whole-cycle failure (as opposed to one farmer's
      // skipped reading, above) means the scheduled job produced zero
      // readings this run — exactly the "silently-never-started" class of
      // failure this issue calls out weather polling for specifically.
      captureAlert(
        "scheduled_job_failed",
        "Weather polling cycle failed — no readings collected this run",
        { error: error instanceof Error ? error.message : String(error) },
      );
    });
  }, intervalMs);
}

export function stopWeatherPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
