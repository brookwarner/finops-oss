import { z } from "zod";

/** PATCH /api/investments/inception body */
export const investmentInceptionBodySchema = z.object({
  accountId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export type InvestmentInceptionInput = z.infer<typeof investmentInceptionBodySchema>;
