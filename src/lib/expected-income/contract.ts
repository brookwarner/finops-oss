import { z } from "zod";
import type { Inflow } from "@/lib/cashflow/inflows";

// Amounts are cash expected, in NZD. Tax treatment remains explicit, as in
// manual inflows; this integration does not infer tax or GST from deal values.
export const paymentSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  label: z.string().trim().min(1).max(200),
  amount: z.number().finite().nonnegative().max(1e9),
  receivedAmount: z.number().finite().nonnegative().default(0),
  currency: z.literal("NZD"),
  expectedDate: z.iso.date(),
  status: z.enum(["committed", "speculative", "settled", "cancelled"]),
  taxRate: z.number().min(0).max(1).default(0),
  dealId: z.string().max(100).optional(),
}).strict().refine((p) => p.receivedAmount <= p.amount, "receivedAmount exceeds amount");

export const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal("brookos"),
  generatedAt: z.iso.datetime({ offset: true }),
  payments: z.array(paymentSchema).max(500),
}).strict().refine((s) => new Set(s.payments.map((p) => p.id)).size === s.payments.length,
  "duplicate payment ids");

export type IncomeSnapshot = z.infer<typeof snapshotSchema>;

export function snapshotInflows(snapshot: IncomeSnapshot): Inflow[] {
  return snapshot.payments.filter((p) => p.status === "committed" || p.status === "speculative")
    .map((p) => ({
      id: `brookos:${p.id}`, label: p.label,
      amount: Math.round((p.amount - p.receivedAmount) * 100) / 100,
      likelihood: p.status === "committed" ? "likely" as const : "uncertain" as const,
      expectedDate: p.expectedDate, taxRate: p.taxRate, autoInclude: p.status === "committed",
    })).filter((p) => p.amount > 0);
}
