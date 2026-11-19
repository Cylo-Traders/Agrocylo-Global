import express from 'express';
import { requireMetricsAuth } from '../middleware/metricsAuth.js';
import { getPlatformMetrics } from '../services/metricsService.js';
import { registry } from '../services/promMetrics.js';

const router = express.Router();

router.get('/metrics', requireMetricsAuth, async (_req, res, next) => {
  try {
    const payload = await getPlatformMetrics();
    res.status(200).type('application/json').json(payload);
  } catch (error) {
    next(error);
  }
});

// Prometheus-format export (Issue #756) — request latency/error rate per
// route, WebSocket connection count, and queue/job lag, in the standard
// text exposition format any metrics backend can scrape.
router.get('/metrics/prom', requireMetricsAuth, async (_req, res, next) => {
  try {
    res
      .status(200)
      .set('Content-Type', registry.contentType)
      .send(await registry.metrics());
  } catch (error) {
    next(error);
  }
});

export default router;
