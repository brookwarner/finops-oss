import { z } from "zod";

/** PATCH /api/transactions/categorise body */
export const categoriseBodySchema = z.object({
  transactionIds: z.array(z.string()).min(1),
  categoryId: z.string().uuid().nullable().optional(),
  category: z.string().optional(),
});

/** POST /api/transactions/apply-similar body */
export const applySimilarBodySchema = z.object({
  merchant: z.string().min(1),
  categoryId: z.string().uuid().optional(),
  category: z.string().optional(),
});

/** POST /api/transactions/accept-suggestions body */
export const acceptSuggestionsBodySchema = z.object({
  transactionIds: z.array(z.string()).optional(),
});

export type CategoriseInput = z.infer<typeof categoriseBodySchema>;
export type ApplySimilarInput = z.infer<typeof applySimilarBodySchema>;
export type AcceptSuggestionsInput = z.infer<typeof acceptSuggestionsBodySchema>;
