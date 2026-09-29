import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { jsonValidated, validateQuery } from '../middleware/validate.js';
import { problemDetail } from '../middleware/errors.js';
import logger from '../config/logger.js';

const router = Router();

// ── Schemas ──────────────────────────────────────────────────────────────────

const AdvisoryQuerySchema = z.object({
  farmerId: z.string().optional(),
  lat: z.string().transform(Number).pipe(z.number().min(-90).max(90)).optional(),
  lng: z.string().transform(Number).pipe(z.number().min(-180).max(180)).optional(),
});

const WeatherAdvisorySchema = z.object({
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
});

const AdvisoryListResponseSchema = z.array(WeatherAdvisorySchema);

// ── Route ────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/weather/advisories
 *
 * Returns weather advisories for a given farmer or location.
 * Query params: farmerId, lat, lng (all optional).
 *
 * In a full implementation this would query an external weather service
 * (e.g. OpenWeatherMap alerts, NOAA) or an internal advisory table.
 * For now it returns an empty array — the contract is what matters so the
 * frontend can integrate against a documented, validated endpoint.
 */
router.get(
  '/weather/advisories',
  validateQuery(AdvisoryQuerySchema),
  async (req: Request, res: Response) => {
    try {
      const { farmerId, lat, lng } = req.query as unknown as {
        farmerId?: string;
        lat?: number;
        lng?: number;
      };

      logger.info('[Weather] Advisory request', { farmerId, lat, lng });

      // Can be replaced with a real weather-data source
      const advisories: z.infer<typeof AdvisoryListResponseSchema> = [];

      jsonValidated(res, AdvisoryListResponseSchema, 200, advisories);
    } catch (err) {
      logger.error('[Weather] Failed to fetch advisories', err);
      problemDetail(res, req, 500, 'Internal Server Error', 'Failed to fetch weather advisories');
    }
  }
);

export default router;
