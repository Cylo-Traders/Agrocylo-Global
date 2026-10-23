import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

export const PRICE_INDEX_STALE_AFTER_SECONDS = 3600;

export const PriceIndexEntrySchema = z.object({
  crop: z.string(),
  region: z.string(),
  averagePrice: z.number().nonnegative(),
  currency: z.literal('XLM'),
  unit: z.literal('XLM_PER_UNIT'),
  sampleCount: z.number().int().positive(),
  sampleSemantics: z.literal('active_marketplace_listings'),
  regionSource: z.literal('campaign_farmer_wallet_prefix'),
  computedAt: z.string(),
});

export const PriceIndexMetaSchema = z.object({
  currency: z.literal('XLM'),
  unit: z.literal('XLM_PER_UNIT'),
  priceScale: z.literal('stroops_1e7_to_xlm'),
  sampleSemantics: z.literal('active_marketplace_listings'),
  regionSource: z.literal('campaign_farmer_wallet_prefix'),
  source: z.literal('marketplace_computed'),
  computedAt: z.string(),
  staleAfterSeconds: z.number().int().positive(),
});

export const PriceIndexResponseSchema = z.object({
  data: z.array(PriceIndexEntrySchema),
  meta: PriceIndexMetaSchema,
});

export type PriceIndexEntry = z.infer<typeof PriceIndexEntrySchema>;
export type PriceIndexMeta = z.infer<typeof PriceIndexMetaSchema>;
export type PriceIndexResponse = z.infer<typeof PriceIndexResponseSchema>;

/**
 * GET /analytics/price-index — Regional crop price index (Issue #696, #1049, #1258)
 *
 * Computes regional price averages strictly from active marketplace product
 * listings. Never returns fabricated benchmark rows or invented sample counts
 * when the marketplace has no active products.
 */
router.get('/analytics/price-index', asyncHandler(async (_req: Request, res: Response) => {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    include: { campaign: true },
    take: 100,
  });

  const computedAt = new Date().toISOString();

  // Group active products by crop and campaign farmer region prefix
  const grouped = new Map<string, { totalTokens: bigint; count: number; crop: string; region: string }>();

  for (const p of products) {
    const crop = (p.name || p.category || '').trim();
    if (!crop) continue;
    const region = p.campaign?.farmerAddress
      ? `Region-${p.campaign.farmerAddress.slice(0, 6)}`
      : 'Global';
    const key = `${crop}::${region}`;

    const existing = grouped.get(key) || { totalTokens: 0n, count: 0, crop, region };
    existing.totalTokens += BigInt(p.priceTokens);
    existing.count += 1;
    grouped.set(key, existing);
  }

  const data: PriceIndexEntry[] = [];

  for (const val of grouped.values()) {
    // Convert stroops (10^7) to XLM unit price for display
    const avgPrice = Number(val.totalTokens) / Number(val.count) / 10_000_000;
    data.push({
      crop: val.crop,
      region: val.region,
      averagePrice: Number(avgPrice.toFixed(4)),
      currency: 'XLM',
      unit: 'XLM_PER_UNIT',
      sampleCount: val.count,
      sampleSemantics: 'active_marketplace_listings',
      regionSource: 'campaign_farmer_wallet_prefix',
      computedAt,
    });
  }

  const responsePayload: PriceIndexResponse = {
    data,
    meta: {
      currency: 'XLM',
      unit: 'XLM_PER_UNIT',
      priceScale: 'stroops_1e7_to_xlm',
      sampleSemantics: 'active_marketplace_listings',
      regionSource: 'campaign_farmer_wallet_prefix',
      source: 'marketplace_computed',
      computedAt,
      staleAfterSeconds: PRICE_INDEX_STALE_AFTER_SECONDS,
    },
  };

  res.status(200).json(responsePayload);
}));

export default router;
