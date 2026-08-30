import { z } from "zod";

/** GET /api/cashflow query params */
export const cashflowQuerySchema = z.object({
  cut: z.coerce.number().min(0).max(100).optional(),
  income: z.coerce.number().min(0).optional(),
  /** Present = assume all expected inflows land at their expected date. */
  lump: z.string().optional(),
});

export type CashflowQueryInput = z.infer<typeof cashflowQuerySchema>;
