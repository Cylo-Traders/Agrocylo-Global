import { z } from "zod";

const MonetaryString = z.string().regex(/^\d+(\.\d{1,8})?$/, "Invalid monetary value");

export const PriceIndexEntrySchema = z.object({
  crop: z.string(),
  region: z.string(),
  currency: z.string(),
  avgPrice: z.number(),
  minPrice: z.number(),
  maxPrice: z.number(),
  sampleCount: z.number().int(),
  sourceCounts: z.record(z.number().int()),
});

export const PriceIndexResponseSchema = z.object({
  data: z.array(PriceIndexEntrySchema),
});

export type PriceIndexEntry = z.infer<typeof PriceIndexEntrySchema>;
export type PriceIndexResponse = z.infer<typeof PriceIndexResponseSchema>;

export function validateResponse<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const messages = result.error.errors
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join("; ");
    throw new Error(`Response validation failed: ${messages}`);
  }
  return result.data;
}
