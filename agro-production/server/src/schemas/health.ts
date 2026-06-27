import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.literal("UP"),
  service: z.string(),
  env: z.string(),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const LivezResponseSchema = z.object({
  status: z.literal("alive"),
  uptime: z.number(),
  timestamp: z.string().datetime(),
});

export type LivezResponse = z.infer<typeof LivezResponseSchema>;

export const ReadyzResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  checks: z.record(z.object({
    status: z.enum(["UP", "DOWN"]),
    message: z.string().optional(),
  })),
  lastLedger: z.number().optional(),
  timestamp: z.string().datetime(),
});

export type ReadyzResponse = z.infer<typeof ReadyzResponseSchema>;
