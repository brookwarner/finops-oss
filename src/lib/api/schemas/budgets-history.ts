import { z } from "zod";

/** GET /api/budgets/history query params */
export const budgetHistoryQuerySchema = z.object({
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(36).optional(),
});

export type BudgetHistoryQueryInput = z.infer<typeof budgetHistoryQuerySchema>;
