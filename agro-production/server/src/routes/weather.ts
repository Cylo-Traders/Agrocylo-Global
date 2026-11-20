import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { jsonValidated, validateQuery } from '../middleware/validate.js';
import { problemDetail } from '../middleware/errors.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import logger from '../config/logger.js';
import { getWeatherAdvisories } from '../services/weatherAdvisoryService.js';

const router = Router();

// ── Schemas ──────────────────────────────────────────────────────────────────

const AdvisoryQuerySchema = z.object({
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
  maxDistanceKm: z
    .string()
    .transform(Number)
    .pipe(z.number().positive().max(20000))
    .optional(),
});

export const WeatherAdvisorySchema = z.object({
  id: z.string(),
  severity: z.enum(['low', 'moderate', 'high', 'extreme']),
  type: z.string(),
  description: z.string(),
  location: z.object({
    lat: z.number(),
    lng: z.number(),
    name: z.string(),
  }),
  issuedAt: z.string(),
  expiresAt: z.string().optional(),
  farmerId: z.string().optional(),
});

export const AdvisoryResponseSchema = z.object({
  status: z.enum(['ok', 'stale', 'unavailable']),
  advisories: z.array(WeatherAdvisorySchema),
  fetchedAt: z.string().nullable(),
  source: z.string().nullable(),
  stale: z.boolean(),
  message: z.string().optional(),
});

// ── Route ────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/weather/advisories
 *
 * Returns weather advisories for a given farmer or location along with an
 * explicit availability and freshness envelope (`status`: "ok" | "stale" | "unavailable")
 * so clients never mistake unconfigured or failed weather fetches for favorable conditions.
 */
router.get(
  '/weather/advisories',
  validateQuery(AdvisoryQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { farmerId, lat, lng, maxDistanceKm } = req.query as unknown as {
        farmerId?: string;
        lat?: number;
        lng?: number;
        maxDistanceKm?: number;
      };

      logger.info('[Weather] Advisory request', {
        farmerId,
        lat,
        lng,
        maxDistanceKm,
      });

      const result = await getWeatherAdvisories({
        farmerId,
        lat,
        lng,
        maxDistanceKm,
      });

      jsonValidated(res, AdvisoryResponseSchema, 200, result);
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
