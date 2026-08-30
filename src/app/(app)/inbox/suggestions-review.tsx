// src/app/(app)/inbox/suggestions-review.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CategoryDropdown, type Cat } from "@/components/category-dropdown";
import { formatCurrency } from "@/lib/format";

export type Suggestion = {
  id: string;
  merchant: string | null;
  description: string | null;
  amount: number;
  category_id: string | null;
  account_type: string | null;
};

// Akahu signs debits negative on every account type — a credit-card or loan
// charge reads the same as an everyday-account purchase — so the outflow is
// uniformly a negative amount, with no liability-type flip. Mirrors
// displaySign() in transactions-table.tsx and the budget compute paths.
function outflow(amount: number, _type: string | null) {
  const isOut = amount < 0;
  return { isOut, abs: Math.abs(amount) };
}

export function SuggestionsReview({
  initial,
  categories,
}: {
  initial: Suggestion[];
  categories: Cat[];
}) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  if (rows.length === 0) return null;

  async function acceptAll() {
    setBusy(true);
    try {
      const res = await fetch("/api/transactions/accept-suggestions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionIds: rows.map((r) => r.id) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "accept failed");
      setRows([]);
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function editRow(row: Suggestion, categoryId: string | null) {
    setBusy(true);
    try {
      const res = await fetch("/api/transactions/categorise", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionIds: [row.id], categoryId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "update failed");
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      if (data.similarCount > 0 && categoryId && row.merchant) {
        const apply = confirm(`Apply "${row.merchant}" to ${data.similarCount} similar past transaction(s)?`);
        if (apply) {
          const simRes = await fetch("/api/transactions/apply-similar", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ merchant: row.merchant, categoryId }),
          });
          if (!simRes.ok) {
            alert((await simRes.json().catch(() => ({}))).error ?? "apply-similar failed");
          }
        }
      }
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 rounded-card bg-accent-weak p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-accent">Suggested by Claude ({rows.length})</h2>
        <button
          type="button"
          onClick={acceptAll}
          disabled={busy}
          className="rounded-control bg-accent px-3 py-1 text-sm font-medium text-white transition-colors hover:brightness-110 disabled:opacity-50"
        >
          Accept all
        </button>
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => {
            const { isOut } = outflow(r.amount, r.account_type);
            return (
              <tr key={r.id} className="border-t border-accent/15">
                <td className="py-1.5 pr-2 text-ink">
                  <span className="block max-w-[8rem] truncate sm:max-w-none">
                    {r.merchant ?? r.description}
                  </span>
                </td>
                <td className="py-1.5">
                  <CategoryDropdown
                    value={r.category_id}
                    categories={categories}
                    onChange={(id) => editRow(r, id)}
                    disabled={busy}
                  />
                </td>
                <td className={`py-1.5 pl-2 text-right tabular-nums ${isOut ? "text-negative" : "text-positive"}`}>
                  {formatCurrency(r.amount, { signDisplay: "always" })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
