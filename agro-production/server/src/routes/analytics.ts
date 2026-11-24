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
 * Every active listing is aggregated (Issue #1342): listings are read in
 * keyset pages ordered by id, so `meta.totalListings` equals the sum of
 * every group's `sampleCount` and the result does not depend on row order.
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
    /** Every active listing is aggregated — no sampling (Issue #1342). */
    samplingPolicy: z.literal('all active listings'),
    /** Number of listings included across all groups. */
    totalListings: z.number().int().nonnegative(),
    computedAt: z.string().datetime(),
  }),
});

export type PriceIndexResponse = z.infer<typeof PriceIndexResponseSchema>;

/** Page size used to stream the full eligible listing set (Issue #1342). */
export const PRICE_INDEX_PAGE_SIZE = 500;

type PriceIndexListing = {
  id: string;
  name: string;
  category: string;
  priceTokens: bigint;
  campaign: { farmerAddress: string } | null;
};

/**
 * Read every active listing (Issue #1342). Pages by primary key with a
 * keyset cursor so the result covers the complete eligible set and never
 * depends on the database's physical row order.
 */
async function loadAllActiveListings(): Promise<PriceIndexListing[]> {
  const listings: PriceIndexListing[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page: PriceIndexListing[] = await prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        category: true,
        priceTokens: true,
        campaign: { select: { farmerAddress: true } },
      },
      orderBy: { id: 'asc' },
      take: PRICE_INDEX_PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    listings.push(...page);
    if (page.length < PRICE_INDEX_PAGE_SIZE) break;
    cursor = page[page.length - 1].id;
  }
  return listings;
}

router.get(
  '/analytics/price-index',
  asyncHandler(async (_req: Request, res: Response) => {
    const products = await loadAllActiveListings();

    const computedAt = new Date().toISOString();

    const grouped = new Map<
      string,
      { crop: string; region: string; totalTokens: bigint; count: number }
    >();

    for (const p of products) {
      const crop = p.name || p.category;
      const region = p.campaign?.farmerAddress
        ? `Region-${p.campaign.farmerAddress.slice(0, 6)}`
        : 'Global';
      // JSON key avoids collisions when a crop name contains a separator.
      const key = JSON.stringify([crop, region]);

      const existing = grouped.get(key) || {
        crop,
        region,
        totalTokens: 0n,
        count: 0,
      };
      existing.totalTokens += BigInt(p.priceTokens);
      existing.count += 1;
      grouped.set(key, existing);
    }

    const data = [...grouped.values()]
      .map((val) => {
        const avgPrice =
          Number(val.totalTokens / BigInt(val.count)) / 10_000_000;
        return {
          crop: val.crop,
          region: val.region,
          averagePrice: Number(avgPrice.toFixed(4)),
          sampleCount: val.count,
          computedAt,
        };
      })
      // Deterministic output order, independent of insertion order.
      .sort((a, b) =>
        a.crop === b.crop
          ? a.region.localeCompare(b.region)
          : a.crop.localeCompare(b.crop),
      );

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
        samplingPolicy: 'all active listings',
        totalListings: products.length,
        computedAt,
      },
    };

    res.status(200).json(response);
  }),
);

export default router;
