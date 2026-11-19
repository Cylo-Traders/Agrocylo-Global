import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

/**
 * GET /analytics/price-index response contract (Issue #696, #1189, #1258).
 *
 * `averagePrice` is XLM per product token. Listings store `priceTokens` in
 * stroops (1 XLM = 10_000_000 stroops); the entry is the integer mean of the
 * grouped listings converted to XLM and rounded to four decimals.
 *
 * `sampleCount` counts active marketplace product listings in the group. It
 * is not a count of confirmed orders, trades or external observations, and
 * no benchmark rows are fabricated when there is no marketplace data.
 *
 * `region` is derived from the linked campaign's farmer address
 * (`Region-<first six characters>`), or `Global` when the listing has no
 * campaign. It is not a declared geo-location.
 *
 * `computedAt` is the UTC time the aggregation ran; `meta` repeats the
 * units and semantics so clients can label the data without guessing.
 */
export const PriceIndexEntrySchema = z.object({
  crop: z.string(),
  region: z.string(),
  averagePrice: z.number().nonnegative(),
  sampleCount: z.number().int().positive(),
  computedAt: z.string().datetime(),
});

export const PriceIndexResponseSchema = z.object({
  data: z.array(PriceIndexEntrySchema),
  meta: z.object({
    source: z.literal('marketplace'),
    currency: z.literal('XLM'),
    unit: z.literal('XLM per product token'),
    sampleSemantics: z.literal(
      'count of active marketplace product listings in the group',
    ),
    regionSource: z.literal(
      'linked campaign farmer address prefix, or Global when unlinked',
    ),
    computedAt: z.string().datetime(),
  }),
});

export type PriceIndexResponse = z.infer<typeof PriceIndexResponseSchema>;

router.get(
  '/analytics/price-index',
  asyncHandler(async (_req: Request, res: Response) => {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      include: { campaign: true },
      orderBy: [{ id: 'asc' }],
    });

    const computedAt = new Date().toISOString();

    const grouped = new Map<
      string,
      { totalTokens: bigint; count: number; region: string }
    >();

    for (const p of products) {
      const crop = p.name || p.category;
      const region = p.campaign?.farmerAddress
        ? `Region-${p.campaign.farmerAddress.slice(0, 6)}`
        : 'Global';
      const key = `${crop}:${region}`;

      const existing = grouped.get(key) || {
        totalTokens: 0n,
        count: 0,
        region,
      };
      existing.totalTokens += p.priceTokens;
      existing.count += 1;
      grouped.set(key, existing);
    }

    const data = [...grouped.entries()]
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, val]) => {
      const [crop] = key.split(':');
      const avgPrice = Number(val.totalTokens / BigInt(val.count)) / 10_000_000;
      return {
        crop,
        region: val.region,
        averagePrice: Number(avgPrice.toFixed(4)),
        sampleCount: val.count,
        computedAt,
      };
    });

    const response: PriceIndexResponse = {
      data,
      meta: {
        source: 'marketplace',
        currency: 'XLM',
        unit: 'XLM per product token',
        sampleSemantics:
          'count of active marketplace product listings in the group',
        regionSource:
          'linked campaign farmer address prefix, or Global when unlinked',
        computedAt,
      },
    };

    res.status(200).json(response);
  }),
);

export default router;
