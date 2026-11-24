import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { jsonValidated, validateQuery } from '../middleware/validate.js';
import { problemDetail } from '../middleware/errors.js';
import logger from '../config/logger.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { config } from '../config/index.js';
import {
  WeatherAdvisorySchema,
  WeatherAdvisoryService,
} from '../services/weatherAdvisoryService.js';

const router = Router();

// ── Schemas ──────────────────────────────────────────────────────────────────

const AdvisoryQuerySchema = z
  .object({
    farmerId: z.string().optional(),
    lat: z
      .string()
      .transform(Number)
      .pipe(z.number().min(-90).max(90))
      .optional(),
    lng: z
      .string()
      .transform(Number)
      .pipe(z.number().min(-180).max(180))
      .optional(),
    radiusKm: z
      .string()
      .transform(Number)
      .pipe(z.number().positive().max(2000))
      .optional(),
  })
  .refine((q) => (q.lat === undefined) === (q.lng === undefined), {
    message: 'lat and lng must be provided together',
    path: ['lat'],
  });

/**
 * Response envelope (Issue #1341). `status` distinguishes:
 *   - `ok`          — fresh provider data; an empty list means no active
 *                     advisories for the area, nothing more.
 *   - `stale`       — the latest refresh failed; advisories are from the last
 *                     good snapshot (`fetchedAt`), still within the max age.
 *   - `unavailable` — no trustworthy data (provider not configured, failing
 *                     with no usable cache, or the snapshot has expired).
 * Clients must never treat an empty list as "favorable conditions".
 */
export const AdvisoryListResponseSchema = z.object({
  status: z.enum(['ok', 'stale', 'unavailable']),
  advisories: z.array(WeatherAdvisorySchema),
  fetchedAt: z.string().datetime().nullable(),
  ageSeconds: z.number().int().nonnegative().nullable(),
  reason: z
    .enum(['provider_not_configured', 'provider_error', 'data_expired'])
    .optional(),
  radiusKm: z.number().positive().optional(),
});

export const weatherAdvisoryService = new WeatherAdvisoryService(
  config.weatherAdvisory,
);

// ── Route ────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/weather/advisories
 *
 * Returns active (unexpired) advisories from the configured provider,
 * filtered to `radiusKm` (default WEATHER_ADVISORY_RADIUS_KM) around
 * `lat`/`lng` when supplied. Responds 503 with the same envelope when data is
 * unavailable, so monitors and clients both see the outage.
 */
router.get(
  '/weather/advisories',
  validateQuery(AdvisoryQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { farmerId, lat, lng, radiusKm } = req.query as unknown as {
        farmerId?: string;
        lat?: number;
        lng?: number;
        radiusKm?: number;
      };

      logger.info('[Weather] Advisory request', { farmerId, lat, lng });

      const result = await weatherAdvisoryService.getAdvisories({
        lat,
        lng,
        radiusKm,
      });

      if (result.status === 'unavailable') {
        res.setHeader('Retry-After', '60');
      }
      jsonValidated(
        res,
        AdvisoryListResponseSchema,
        result.status === 'unavailable' ? 503 : 200,
        result,
      );
    } catch (err) {
      logger.error('[Weather] Failed to fetch advisories', err);
      problemDetail(
        res,
        req,
        500,
        'Internal Server Error',
        'Failed to fetch weather advisories',
      );
    }
  }),
);

export default router;
