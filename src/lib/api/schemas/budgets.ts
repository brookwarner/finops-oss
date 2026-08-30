import { z } from "zod";

/** GET /api/budgets query params */
export const budgetsQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  group: z.string().optional(),
  category: z.string().optional(),
});

/** PATCH /api/budgets/target body — moved from validation.ts */
export const setBudgetTargetSchema = z.object({
  category: z.string().min(1),
  monthlyTarget: z.number().min(0).refine(Number.isFinite, {
    message: "monthlyTarget must be a finite number",
  }),
});
export type SetBudgetTargetInput = z.infer<typeof setBudgetTargetSchema>;

/** POST /api/budgets body — create a net-new budget (+ category if it doesn't exist yet). */
export const createBudgetSchema = z.object({
  category: z.string().min(1),
  kind: z.enum(["monthly_cap", "reserve", "ap_amortised", "income", "savings"]),
  monthlyTarget: z.number().min(0).refine(Number.isFinite, {
    message: "monthlyTarget must be a finite number",
  }),
  group: z.string().min(1).optional(),
});
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;
