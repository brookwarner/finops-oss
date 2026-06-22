import { z } from "zod";

/** DELETE /api/assets query params */
export const assetsDeleteQuerySchema = z.object({
  id: z.string().startsWith("manual_"),
});

/** POST /api/assets body */
export const assetsUpsertBodySchema = z.object({
  id: z.string().startsWith("manual_").optional(),
  name: z.string().min(1),
  balance: z.number(),
  type: z.string().optional(),
  currency: z.string().optional(),
  institution: z.string().optional(),
  loan: z.object({
    annualRate: z.number().min(0),
    repaymentCategoryId: z.string().uuid().optional(),
    repaymentCategory: z.string().optional(),
    anchorDate: z.string().optional(),
  }).optional(),
  inflow: z.object({
    likelihood: z.enum(["likely", "uncertain"]).optional(),
    expectedDate: z.string().nullable().optional(),
    preTax: z.boolean().optional(),
    taxRate: z.number().min(0).max(1).optional(),
  }).optional(),
});

export type AssetsUpsertInput = z.infer<typeof assetsUpsertBodySchema>;
