import { z } from "zod";

/** GET /api/review query params */
export const reviewQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type ReviewQueryInput = z.infer<typeof reviewQuerySchema>;
