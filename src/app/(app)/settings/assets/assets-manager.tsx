"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/format";
import type { ManualAsset } from "@/lib/assets/store";

const TYPE_OPTIONS = [
  { value: "other", label: "Other (net worth only)" },
  { value: "investment", label: "Investment (feeds FI)" },
  { value: "savings", label: "Savings (feeds FI)" },
  { value: "receivable", label: "Receivable (money owed to you)" },
];

export function AssetsManager({
  initial,
  categories,
}: {
  initial: ManualAsset[];
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("");
  const [type, setType] = useState("other");
  const [error, setError] = useState<string | null>(null);
  const [isLoan, setIsLoan] = useState(false);
  const [rate, setRate] = useState("0");
  const [categoryId, setCategoryId] = useState("");
  const [loanAnchorDate, setLoanAnchorDate] = useState("");
  // inflow sub-form (shown when type === "receivable")
  const [likelihood, setLikelihood] = useState<"likely" | "uncertain">("likely");
  const [expectedDate, setExpectedDate] = useState("");
  const [preTax, setPreTax] = useState(false);
  const [taxRate, setTaxRate] = useState("");

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the asset a name.");
      return;
    }
    if (balance.trim() === "" || !Number.isFinite(Number(balance))) {
      setError("Enter a balance (negative for a liability).");
      return;
    }
    const body: Record<string, unknown> = { name: trimmed, balance: Number(balance), type };
    if (isLoan) {
      if (!categoryId) {
        setError("Pick the repayment category for the loan.");
        return;
      }
      body.loan = { annualRate: Number(rate) || 0, repaymentCategoryId: categoryId, anchorDate: loanAnchorDate || undefined };
    }
    if (type === "receivable") {
      body.inflow = {
        likelihood,
        expectedDate: expectedDate || null,
        preTax,
        taxRate: preTax ? Number(taxRate) || 0 : 0,
      };
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Save failed");
      return;
    }
    setName("");
    setBalance("");
    setType("other");
    setIsLoan(false);
    setRate("0");
    setCategoryId("");
    setLoanAnchorDate("");
    setLikelihood("likely");
    setExpectedDate("");
    setPreTax(false);
    setTaxRate("");
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Remove this manual asset?")) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/assets?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Remove failed");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {initial.length === 0 ? (
        <p className="rounded-card bg-surface p-4 text-sm text-ink-muted shadow-card">
          No manual assets yet. Add one below.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {initial.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-card bg-surface p-4 shadow-card"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">
                  {a.name}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                  <span className={a.balance < 0 ? "text-negative" : ""}>
                    {formatCurrency(a.balance, { currency: a.currency })}
                  </span>
                  <span className="text-ink-faint">·</span>
                  <span>{a.type}</span>
                  {a.feedsFI && (
                    <span className="rounded-control bg-accent-weak px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      FI
                    </span>
                  )}
                  {a.autoRefreshed && (
                    <span className="rounded-control bg-sunken px-1.5 py-0.5 text-[10px] text-ink-faint">
                      auto-refreshed
                    </span>
                  )}
                  {a.loan && (
                    <span className="rounded-control bg-sunken px-1.5 py-0.5 text-[10px] text-ink-faint">
                      loan {a.loan.annualRate}% · {a.loan.repaymentCategoryName ?? "?"}
                    </span>
                  )}
                  {a.inflow && (
                    <span className="rounded-control bg-sunken px-1.5 py-0.5 text-[10px] text-ink-faint">
                      {a.inflow.likelihood}
                      {a.inflow.expectedDate ? ` · by ${a.inflow.expectedDate}` : ""}
                      {a.inflow.preTax ? ` · ${Math.round(a.inflow.taxRate * 100)}% tax` : ""}
                    </span>
                  )}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(a.id)}
                disabled={busy}
                className="cursor-pointer rounded-control border border-negative/30 px-2 py-0.5 text-xs text-negative transition-colors hover:bg-negative-weak disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 rounded-card bg-surface p-5 shadow-card">
        <h2 className="mb-3 text-sm font-semibold text-ink">Add an asset</h2>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-ink-muted">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Personal loan, Car loan"
              className="w-full rounded-control border border-hairline bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-muted">
              Balance (negative for a liability)
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-control border border-hairline bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-muted">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-control border border-hairline bg-surface px-2.5 py-2 text-sm text-ink"
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={isLoan}
              onChange={(e) => setIsLoan(e.target.checked)}
            />
            This is a loan I&apos;m paying down
          </label>
          {isLoan && (
            <div className="space-y-3 rounded-control border border-hairline p-3">
              <label className="block">
                <span className="mb-1 block text-xs text-ink-muted">Annual rate %</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  className="w-full rounded-control border border-hairline bg-surface px-2 py-1.5 text-sm text-ink"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink-muted">Repayment category</span>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full rounded-control border border-hairline bg-surface px-2.5 py-2 text-sm text-ink"
                >
                  <option value="">Select a category…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink-muted">Loan as of (optional — defaults to today)</span>
                <input
                  type="date"
                  value={loanAnchorDate}
                  onChange={(e) => setLoanAnchorDate(e.target.value)}
                  className="w-full rounded-control border border-hairline bg-surface px-2 py-1.5 text-sm text-ink"
                />
              </label>
            </div>
          )}

          {type === "receivable" && (
            <div className="space-y-3 rounded-control border border-hairline p-3">
              <label className="block">
                <span className="mb-1 block text-xs text-ink-muted">Likelihood</span>
                <select
                  value={likelihood}
                  onChange={(e) => setLikelihood(e.target.value as "likely" | "uncertain")}
                  className="w-full rounded-control border border-hairline bg-surface px-2.5 py-2 text-sm text-ink"
                >
                  <option value="likely">Likely</option>
                  <option value="uncertain">Uncertain</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink-muted">Expected date (optional)</span>
                <input
                  type="date"
                  value={expectedDate}
                  onChange={(e) => setExpectedDate(e.target.value)}
                  className="w-full rounded-control border border-hairline bg-surface px-2 py-1.5 text-sm text-ink"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={preTax}
                  onChange={(e) => setPreTax(e.target.checked)}
                />
                This is pre-tax income
              </label>
              {preTax && (
                <label className="block">
                  <span className="mb-1 block text-xs text-ink-muted">Tax rate (e.g. 0.39 for 39%)</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={taxRate}
                    onChange={(e) => setTaxRate(e.target.value)}
                    placeholder="0.39"
                    className="w-full rounded-control border border-hairline bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint"
                  />
                </label>
              )}
            </div>
          )}

          {error && <p className="text-sm text-negative">{error}</p>}

          <button
            type="button"
            onClick={add}
            disabled={busy}
            className="cursor-pointer rounded-control bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Add asset"}
          </button>
        </div>
      </div>
    </div>
  );
}
