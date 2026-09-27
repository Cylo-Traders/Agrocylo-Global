/**
 * Indexer status and readiness endpoints.
 * Expose indexing progress and health for UI and monitoring.
 */

import { Router, type Request, type Response } from "express";
import { config } from "../config/index.js";
import { getIndexerReadiness } from "../services/indexerReadinessService.js";
import { jsonValidated } from "../middleware/validate.js";
import { z } from "zod";

const router = Router();

const IndexerReadinessSchema = z.object({
  isReady: z.boolean(),
  lastProcessedLedger: z.number(),
  lastProcessedTime: z.string().nullable(),
  freshnessSeconds: z.number(),
  isFresh: z.boolean(),
  maxLagSeconds: z.number(),
  cursor: z
    .object({
      ledger: z.number(),
      eventIndex: z.number(),
    })
    .nullable(),
});

// GET /indexer/readiness — check indexer health and backfill progress
router.get("/readiness", async (req: Request, res: Response) => {
  const readiness = await getIndexerReadiness(config.contractId, 300);
  jsonValidated(res, IndexerReadinessSchema, 200, {
    ...readiness,
    lastProcessedTime: readiness.lastProcessedTime?.toISOString() ?? null,
  });
});

export default router;
