import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ApiError, sendProblem } from '../http/errors.js';
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- referenced as a type only
const AdvisoryListResponseSchema = z.array(WeatherAdvisorySchema);

// ── Route ────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/weather/advisories
 *
 * Returns weather advisories for a given farmer or location.
 * Query params: farmerId, lat, lng (all optional).
 *
 * This endpoint returns a validated, documented contract that the frontend can
 * integrate against. The backing data source can be swapped in without changing
 * the response schema.
 */
router.get('/weather/advisories', async (req: Request, res: Response) => {
  const parsed = AdvisoryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendProblem(
      res,
      req,
      new ApiError(
        400,
        'Validation Failed',
        'Invalid weather advisory query parameters',
        'https://cylos.io/errors/validation'
      )
    );
    return;
  }

  try {
    const { farmerId, lat, lng } = parsed.data;

    logger.info('[Weather] Advisory request', { farmerId, lat, lng });

    // Can be replaced with a real weather-data source
    const advisories: z.infer<typeof AdvisoryListResponseSchema> = [];

    res.status(200).json(advisories);
  } catch (err) {
    logger.error('[Weather] Failed to fetch advisories', err);
    sendProblem(
      res,
      req,
      new ApiError(500, 'Internal Server Error', 'Failed to fetch weather advisories')
    );
  }
});

export default router;
