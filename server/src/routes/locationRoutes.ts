import { Router } from 'express';
import type { Request, Response } from 'express';
import { getFarmerLocations } from '../services/locationService.js';
import logger from '../config/logger.js';

const router = Router();

/**
 * GET /locations/farmers
 *
 * Query params (all optional):
 *   lat    - user latitude
 *   lng    - user longitude
 *   radius - filter radius in km
 *
 * Returns `{ farmers: FarmerLocationRow[] }`
 */
router.get('/locations/farmers', async (req: Request, res: Response) => {
  try {
    const lat = req.query.lat ? Number(req.query.lat) : undefined;
    const lng = req.query.lng ? Number(req.query.lng) : undefined;
    const radiusKm = req.query.radius ? Number(req.query.radius) : undefined;

    if ((lat != null && isNaN(lat)) || (lng != null && isNaN(lng))) {
      res.status(400).json({ message: 'lat and lng must be valid numbers' });
      return;
    }

    const farmers = await getFarmerLocations(lat, lng, radiusKm);
    res.json({ farmers });
  } catch (error) {
    logger.error('Failed to fetch farmer locations', error);
    res.status(500).json({ message: 'Failed to fetch farmer locations' });
  }
});

export default router;
