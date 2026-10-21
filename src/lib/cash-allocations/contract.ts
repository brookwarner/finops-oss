import { z } from "zod";

export const potSchema = z.strictObject({
  label: z.string().trim().min(1).max(80),
  amount: z.number().finite().min(0).max(999999999).refine(
    (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001,
    "Use dollars and cents",
  ),
});

export const cashAllocationSchema = z.strictObject({
  accountId: z.uuid(),
  revision: z.number().int().positive().nullable(),
  businessCash: z.boolean(),
  wholeAccountLabel: z.string().trim().min(1).max(80).nullable(),
  pots: z.array(potSchema).max(30),
}).refine((v) => !v.wholeAccountLabel || v.pots.length === 0, {
  message: "Choose a whole account or individual allocations, not both",
});

export interface CashAllocationConfig {
  accountId: string;
  revision: number | null;
  businessCash: boolean;
  wholeAccountLabel: string | null;
  pots: { label: string; amount: number }[];
}
