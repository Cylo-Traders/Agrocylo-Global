import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../config/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../config/database.js", () => ({
  prisma: {
    location: { findUnique: vi.fn(), findMany: vi.fn() },
    weatherReading: { create: vi.fn() },
  },
}));

vi.mock("./notificationService.js", () => ({
  NotificationService: { notify: vi.fn() },
}));

vi.mock("./notificationPreferenceService.js", () => ({
  getNotificationPreferences: vi.fn(),
  DEFAULT_NOTIFICATION_PREFS: {
    types: {
      orders: true,
      disputes: true,
      priceAlerts: true,
      system: true,
      demandSignals: false,
      weatherAlerts: true,
    },
    delivery: { toast: true, email: false, push: false },
    sound: true,
    quietHoursEnabled: false,
    quietStart: "22:00",
    quietEnd: "08:00",
  },
}));

import {
  evaluateThresholds,
  pollFarmerWeather,
  pollAllFarmerLocations,
  WEATHER_THRESHOLDS,
  type WeatherReading,
} from "./weatherService.js";
import { prisma } from "../config/database.js";
import { NotificationService } from "./notificationService.js";
import { getNotificationPreferences } from "./notificationPreferenceService.js";
import { NotificationEventType } from "../enums/notificationEventType.js";
import { DEFAULT_NOTIFICATION_PREFS } from "./notificationPreferenceService.js";

const notify = vi.mocked(NotificationService.notify);
const findUnique = vi.mocked(prisma.location.findUnique);
const findMany = vi.mocked(prisma.location.findMany);
const create = vi.mocked(prisma.weatherReading.create);
const getPrefs = vi.mocked(getNotificationPreferences);

function calmReading(overrides: Partial<WeatherReading> = {}): WeatherReading {
  return {
    temperatureC: 22,
    precipitationMm: 0,
    windSpeedKph: 10,
    conditionCode: 1,
    recordedAt: new Date("2026-07-27T00:00:00Z"),
    ...overrides,
  };
}

describe("weatherService.evaluateThresholds", () => {
  it("returns no alerts for calm conditions", () => {
    expect(evaluateThresholds(calmReading())).toEqual([]);
  });

  it("flags heavy rain as a watch", () => {
    const alerts = evaluateThresholds(
      calmReading({ precipitationMm: WEATHER_THRESHOLDS.heavyRainMm }),
    );
    expect(alerts).toEqual([{ severity: "watch", condition: "Heavy rainfall" }]);
  });

  it("flags extreme rain as a warning instead of a watch", () => {
    const alerts = evaluateThresholds(
      calmReading({ precipitationMm: WEATHER_THRESHOLDS.extremeRainMm }),
    );
    expect(alerts).toEqual([{ severity: "warning", condition: "Extreme rainfall" }]);
  });

  it("flags high and extreme wind", () => {
    expect(
      evaluateThresholds(calmReading({ windSpeedKph: WEATHER_THRESHOLDS.highWindKph })),
    ).toEqual([{ severity: "watch", condition: "High wind" }]);
    expect(
      evaluateThresholds(calmReading({ windSpeedKph: WEATHER_THRESHOLDS.extremeWindKph })),
    ).toEqual([{ severity: "warning", condition: "Extreme wind" }]);
  });

  it("flags frost risk and extreme heat", () => {
    expect(
      evaluateThresholds(calmReading({ temperatureC: WEATHER_THRESHOLDS.frostC })),
    ).toEqual([{ severity: "warning", condition: "Frost risk" }]);
    expect(
      evaluateThresholds(calmReading({ temperatureC: WEATHER_THRESHOLDS.extremeHeatC })),
    ).toEqual([{ severity: "warning", condition: "Extreme heat" }]);
  });

  it("combines multiple simultaneous alerts", () => {
    const alerts = evaluateThresholds(
      calmReading({
        precipitationMm: WEATHER_THRESHOLDS.extremeRainMm,
        windSpeedKph: WEATHER_THRESHOLDS.highWindKph,
      }),
    );
    expect(alerts).toHaveLength(2);
    expect(alerts).toEqual(
      expect.arrayContaining([
        { severity: "warning", condition: "Extreme rainfall" },
        { severity: "watch", condition: "High wind" },
      ]),
    );
  });
});

function mockFetchResponse(current: Record<string, number | string>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ current }),
  };
}

describe("weatherService.pollFarmerWeather", () => {
  const wallet = "GFARMER123";

  beforeEach(() => {
    vi.resetAllMocks();
    findUnique.mockResolvedValue({
      wallet_address: wallet,
      lat: 5.6,
      lng: 7.1,
      city: null,
      country: null,
      is_public: true,
    } as never);
    create.mockResolvedValue({} as never);
    getPrefs.mockResolvedValue(DEFAULT_NOTIFICATION_PREFS);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists the raw reading for later oracle-attestation submission", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockFetchResponse({
          temperature_2m: 21,
          precipitation: 0,
          wind_speed_10m: 8,
          weather_code: 1,
          time: "2026-07-27T00:00",
        }),
      ),
    );

    await pollFarmerWeather(wallet);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          walletAddress: wallet,
          lat: 5.6,
          lng: 7.1,
          temperatureC: 21,
          precipitationMm: 0,
          windSpeedKph: 8,
          source: "open-meteo",
        }),
      }),
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("dispatches a notification when a threshold is exceeded and the farmer opted in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockFetchResponse({
          temperature_2m: 25,
          precipitation: WEATHER_THRESHOLDS.extremeRainMm,
          wind_speed_10m: 5,
          weather_code: 65,
        }),
      ),
    );

    await pollFarmerWeather(wallet);

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: wallet,
        type: NotificationEventType.WEATHER_ALERT,
        condition: "Extreme rainfall",
        severity: "warning",
      }),
    );
  });

  it("does not dispatch when the farmer has disabled weather alerts", async () => {
    getPrefs.mockResolvedValue({
      ...DEFAULT_NOTIFICATION_PREFS,
      types: { ...DEFAULT_NOTIFICATION_PREFS.types, weatherAlerts: false },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockFetchResponse({
          temperature_2m: 25,
          precipitation: WEATHER_THRESHOLDS.extremeRainMm,
          wind_speed_10m: 5,
          weather_code: 65,
        }),
      ),
    );

    await pollFarmerWeather(wallet);

    expect(notify).not.toHaveBeenCalled();
  });

  it("is a no-op when the farmer has no registered location", async () => {
    findUnique.mockResolvedValue(null as never);
    vi.stubGlobal("fetch", vi.fn());

    await pollFarmerWeather(wallet);

    expect(create).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("weatherService.pollAllFarmerLocations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    create.mockResolvedValue({} as never);
    getPrefs.mockResolvedValue(DEFAULT_NOTIFICATION_PREFS);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("continues polling remaining farmers after one fails", async () => {
    findMany.mockResolvedValue([
      { wallet_address: "GBAD" },
      { wallet_address: "GGOOD" },
    ] as never);
    findUnique.mockImplementation(async ({ where }: { where: { wallet_address: string } }) => {
      if (where.wallet_address === "GBAD") throw new Error("boom");
      return { wallet_address: "GGOOD", lat: 1, lng: 2 } as never;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockFetchResponse({
          temperature_2m: 20,
          precipitation: 0,
          wind_speed_10m: 5,
          weather_code: 1,
        }),
      ),
    );

    await pollAllFarmerLocations();

    expect(create).toHaveBeenCalledTimes(1);
  });
});
