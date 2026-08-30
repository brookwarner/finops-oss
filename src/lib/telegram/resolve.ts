import type { Cat } from "@/lib/categories/resolve";
import type { TxnRow } from "@/lib/transactions/query";
import type { Interpretation, ResolvedAction } from "./types";

/** Injected lookups so this stays unit-testable without a DB. */
export interface ResolveDeps {
  resolveCategory: (name: string) =>
    Promise<{ ok: true; category: Cat } | { ok: false; reason: "none" | "ambiguous"; candidates: Cat[] }>;
  currentTarget: (categoryId: string) => Promise<number | null>;
  searchTxns: (hint: string) => Promise<TxnRow[]>;
  needsReviewIds: (categoryId: string) => Promise<string[]>;
}

export type ResolveResult =
  | { ok: true; action: ResolvedAction }
  | { ok: false; question: string };

function txnLabel(t: TxnRow): string {
  const who = t.merchant ?? t.description ?? "transaction";
  const amt = "$" + Math.abs(t.amount).toFixed(2);
  const d = new Date(t.occurred_at).toLocaleDateString("en-NZ", { day: "numeric", month: "short" });
  return `${who} ${amt} (${d})`;
}

async function resolveCat(name: string, deps: ResolveDeps) {
  const r = await deps.resolveCategory(name);
  if (r.ok) return { ok: true as const, cat: r.category };
  const names = r.candidates.slice(0, 6).map((c) => c.name).join(", ");
  return { ok: false as const, question: names ? `Which category did you mean: ${names}?` : `I couldn't find a category called "${name}".` };
}

/** Resolve a proposed write to concrete ids, or return a clarify question. */
export async function resolveWrite(
  i: Extract<Interpretation, { kind: "set_budget_target" | "recategorise" | "accept_suggestions" }>,
  deps: ResolveDeps,
): Promise<ResolveResult> {
  if (i.kind === "set_budget_target") {
    const c = await resolveCat(i.category, deps);
    if (!c.ok) return { ok: false, question: c.question };
    const prev = await deps.currentTarget(c.cat.id);
    if (prev === null) return { ok: false, question: `*${c.cat.name}* has no budget yet, so there's no cap to change.` };
    return { ok: true, action: { kind: "set_budget_target", categoryId: c.cat.id, categoryName: c.cat.name, monthlyTarget: i.monthlyTarget, previousTarget: prev } };
  }
  if (i.kind === "recategorise") {
    const c = await resolveCat(i.categoryName, deps);
    if (!c.ok) return { ok: false, question: c.question };
    const matches = await deps.searchTxns(i.txnHint);
    if (matches.length === 0) return { ok: false, question: `I couldn't find a transaction matching "${i.txnHint}".` };
    if (matches.length > 1) {
      const list = matches.slice(0, 5).map((t) => `• ${txnLabel(t)}`).join("\n");
      return { ok: false, question: `More than one transaction matches "${i.txnHint}":\n${list}\nBe more specific (amount, date, or merchant).` };
    }
    const t = matches[0];
    return { ok: true, action: { kind: "recategorise", transactionId: t.id, txnLabel: txnLabel(t), categoryId: c.cat.id, categoryName: c.cat.name } };
  }
  // accept_suggestions
  const c = await resolveCat(i.category, deps);
  if (!c.ok) return { ok: false, question: c.question };
  const ids = await deps.needsReviewIds(c.cat.id);
  if (ids.length === 0) return { ok: false, question: `No pending inbox suggestions in *${c.cat.name}*.` };
  return { ok: true, action: { kind: "accept_suggestions", categoryName: c.cat.name, transactionIds: ids } };
}
