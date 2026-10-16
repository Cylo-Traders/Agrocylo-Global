import express from 'express';
import { getBuyerIntents, getDemandData, getHeatMap, getTrend } from '../services/marketService.js';

const router = express.Router();

/** GET /market/demand — DemandData (volume, intents, heatMap, trend). */
router.get('/market/demand', async (_req, res, next) => {
  try { res.status(200).json(await getDemandData()); } catch (e) { next(e); }
});

/** GET /market/buyer-intents — BuyerIntent[] */
router.get('/market/buyer-intents', async (_req, res, next) => {
  try { res.status(200).json(await getBuyerIntents()); } catch (e) { next(e); }
});

/** GET /market/heatmap — HeatMapPoint[] (buyer demand aggregated by region) */
router.get('/market/heatmap', async (_req, res, next) => {
  try { res.status(200).json(await getHeatMap()); } catch (e) { next(e); }
});

/** GET /market/trend?days=30 — DemandTrendPoint[] (1–365 days) */
router.get('/market/trend', async (req, res, next) => {
  try {
    const raw = Number.parseInt(String(req.query['days'] ?? '30'), 10);
    const days = Number.isNaN(raw) ? 30 : Math.min(Math.max(raw, 1), 365);
    res.status(200).json(await getTrend(days));
  } catch (e) { next(e); }
});

export default router;
