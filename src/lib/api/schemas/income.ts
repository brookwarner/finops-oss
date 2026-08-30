import { z } from "zod";

/** GET /api/income/history query params */
export const incomeHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(36).optional(),
});

export type IncomeHistoryQueryInput = z.infer<typeof incomeHistoryQuerySchema>;
