"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CategoryDropdown } from "@/components/category-dropdown";
import { DateRangePicker } from "@/components/date-range-picker";
import { formatCurrency, formatDateFull } from "@/lib/format";

// Akahu signs debits negative across all account types — a loan interest
// charge reads the same as a card purchase or an everyday-account spend — so a
// negative amount is the outflow regardless of whether the account is a
// liability. Mirrors src/app/(app)/budgets/page.tsx.
function displaySign(amount: number, _accountType?: string | null) {
  const isOutflow = amount < 0;
  return { isOutflow, abs: Math.abs(amount) };
}

function PendingBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-hairline bg-sunken px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint"
      title="Spent at the bank but not yet settled. It'll be categorised automatically once it clears."
    >
      Pending
    </span>
  );
}

export type Txn = {
  id: string;
  occurred_at: string;
  amount: number;
  merchant: string | null;
  description: string | null;
  category_id: string | null;
  is_manual_category: boolean;
  merchant_logo_url: string | null;
  account: { name: string | null; type: string | null } | null;
};

/**
 * A pending (unsettled) transaction. Lives in a separate table, carries no
 * category, and is read-only: it's money already spent at the bank that Akahu
 * hasn't reported as settled yet (1–3 days behind). Auto-categorisation runs
 * the moment it settles into the real `transactions` feed, so there's nothing
 * to action here — it's shown purely so the list matches the bank.
 */
export type PendingTxn = {
  id: string;
  occurred_at: string;
  amount: number;
  description: string | null;
  account: { name: string | null; type: string | null } | null;
};

export type Cat = {
  id: string;
  name: string;
  group: string | null;
};

export type Acct = {
  id: string;
  name: string | null;
};

export function TransactionsTable({
  initialTxns,
  pendingTxns = [],
  categories,
  accounts = [],
  activeCategory = "",
  activeQuery = "",
  activeAccount = "",
  activeFrom = "",
  activeTo = "",
  showFilters = true,
  inbox = false,
}: {
  initialTxns: Txn[];
  /** Read-only pending (unsettled) rows, rendered above the settled list. */
  pendingTxns?: PendingTxn[];
  categories: Cat[];
  accounts?: Acct[];
  activeCategory?: string;
  activeQuery?: string;
  activeAccount?: string;
  activeFrom?: string;
  activeTo?: string;
  showFilters?: boolean;
  /**
   * Inbox mode: after categorising a row, grey it out so it's visually
   * de-emphasised but the list doesn't jump. The change is persisted
   * server-side so it'll fall off on next page load.
   */
  inbox?: boolean;
}) {
  const [txns, setTxns] = useState(initialTxns);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState<string>("");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState(activeQuery);
  const [, startTransition] = useTransition();

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function pushFilter(name: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function applyCategory(transactionIds: string[], categoryId: string | null) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      for (const id of transactionIds) next.add(id);
      return next;
    });
    try {
      const res = await fetch("/api/transactions/categorise", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionIds, categoryId }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? "update failed");
      }
      startTransition(() => {
        setTxns((prev) =>
          prev.map((t) =>
            transactionIds.includes(t.id)
              ? { ...t, category_id: categoryId, is_manual_category: categoryId !== null }
              : t,
          ),
        );
      });
      // Inbox: row no longer "uncategorised" — grey it out so it's
      // visually de-emphasised but the list doesn't jump.
      if (inbox && categoryId !== null) {
        setFadingIds((prev) => {
          const next = new Set(prev);
          for (const id of transactionIds) next.add(id);
          return next;
        });
      }
    } catch (err) {
      console.error(err);
      alert((err as Error).message);
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        for (const id of transactionIds) next.delete(id);
        return next;
      });
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === txns.length) setSelected(new Set());
    else setSelected(new Set(txns.map((t) => t.id)));
  }

  return (
    <>
      {showFilters && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <CategoryDropdown
            value={activeCategory || null}
            categories={categories}
            onChange={(id) => pushFilter("category", id ?? "")}
            placeholder="All categories"
          />
          {accounts.length > 0 && (
            <select
              value={activeAccount}
              onChange={(e) => pushFilter("account", e.target.value)}
              className="rounded-control border border-hairline bg-surface px-2 py-1 text-ink"
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? "Unnamed account"}
                </option>
              ))}
            </select>
          )}
          <input
            type="search"
            placeholder="Search merchant or description"
            value={searchInput}
            onChange={(e) => {
              const v = e.target.value;
              setSearchInput(v);
              // Clearing the field (incl. the native search "✕") fires onChange
              // but not blur/Enter, so commit the empty filter here — otherwise
              // the URL keeps ?q= and the list stays filtered.
              if (v === "" && searchParams.get("q")) pushFilter("q", "");
            }}
            onBlur={() => pushFilter("q", searchInput)}
            onKeyDown={(e) => {
              if (e.key === "Enter") pushFilter("q", searchInput);
            }}
            className="grow rounded-control border border-hairline bg-surface px-2 py-1 text-ink placeholder:text-ink-faint"
          />
          {/* Date range is URL-controlled (?from&to) — these params arrive set
              when you land here from a budget row's "View all transactions", and
              were previously invisible/uneditable. Reuse the Budgets picker so
              the range can be tweaked or cleared in place. */}
          <DateRangePicker
            from={activeFrom}
            to={activeTo}
            emptyLabel="All dates"
            resetLabel="Clear dates"
          />
          {(activeCategory || activeQuery || activeAccount || activeFrom || activeTo) && (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                const params = new URLSearchParams(searchParams.toString());
                params.delete("category");
                params.delete("q");
                params.delete("account");
                params.delete("from");
                params.delete("to");
                router.replace(`${pathname}?${params.toString()}`, { scroll: false });
              }}
              className="rounded-control border border-hairline px-2 py-1 text-xs text-ink-muted hover:bg-sunken"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="sticky top-0 z-10 -mx-6 mb-3 flex items-center gap-3 border-y border-hairline bg-sunken px-6 py-2.5 text-sm">
          <div>
            <strong className="text-ink-strong">{selected.size}</strong> selected
          </div>
          <CategoryDropdown
            value={bulkCat || null}
            categories={categories}
            onChange={(v) => setBulkCat(v ?? "")}
            placeholder="Choose category…"
          />
          <button
            type="button"
            className="rounded-control bg-accent px-3 py-1 font-medium text-white transition-colors hover:brightness-110 disabled:opacity-50"
            disabled={!bulkCat}
            onClick={async () => {
              const ids = Array.from(selected);
              await applyCategory(ids, bulkCat || null);
              setSelected(new Set());
              setBulkCat("");
            }}
          >
            Apply
          </button>
          <button
            type="button"
            className="rounded-control border border-hairline px-3 py-1 text-ink-muted hover:bg-surface"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      {/* Mobile (<sm): a stacked card per transaction. A six-column table can't
          fit a phone — the fixed Category/Amount columns squeeze the Merchant
          column (the one field you need to identify a row) down to nothing, and
          the header text collides — so on small screens each transaction becomes
          a card: merchant + amount on top, date/account as metadata, and the
          category picker below with room to breathe. The table takes over at `sm`. */}
      <div className="sm:hidden">
        <label className="flex items-center gap-2 border-b border-hairline py-2 text-[11px] uppercase tracking-wide text-ink-faint">
          <input
            type="checkbox"
            checked={selected.size > 0 && selected.size === txns.length}
            onChange={toggleSelectAll}
          />
          Select all
        </label>
        <ul>
          {pendingTxns.map((p) => {
            const { isOutflow } = displaySign(Number(p.amount), p.account?.type);
            return (
              <li
                key={`pending-${p.id}`}
                className="flex items-start gap-3 border-t border-hairline py-3 opacity-60"
              >
                {/* checkbox column spacer — pending rows aren't selectable */}
                <span className="mt-1 h-4 w-4 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[10px] font-medium text-ink-muted">
                        {(p.description ?? "?").charAt(0).toUpperCase()}
                      </span>
                      <span className="truncate font-medium text-ink-strong">
                        {p.description ?? "Pending transaction"}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 whitespace-nowrap tabular-nums ${
                        isOutflow ? "text-negative" : "text-positive"
                      }`}
                    >
                      {formatCurrency(Number(p.amount), { signDisplay: "always" })}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-ink-faint">
                    <PendingBadge />
                    <span className="truncate">
                      {formatDateFull(p.occurred_at)}
                      {p.account?.name ? ` · ${p.account.name}` : ""}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
          {txns.map((t) => {
            const { isOutflow } = displaySign(Number(t.amount), t.account?.type);
            const isPending = pendingIds.has(t.id);
            const isFading = fadingIds.has(t.id);
            return (
              <li
                key={t.id}
                className={`flex items-start gap-3 border-t border-hairline py-3 transition-opacity duration-700 ${
                  isFading ? "opacity-40" : "opacity-100"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1 shrink-0"
                  checked={selected.has(t.id)}
                  onChange={() => toggleSelect(t.id)}
                  disabled={isFading}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      {t.merchant_logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.merchant_logo_url}
                          alt=""
                          className="h-5 w-5 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[10px] font-medium text-ink-muted">
                          {(t.merchant ?? t.description ?? "?").charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span className="truncate font-medium text-ink-strong">
                        {t.merchant ?? t.description}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 whitespace-nowrap tabular-nums ${
                        isOutflow ? "text-negative" : "text-positive"
                      }`}
                    >
                      {formatCurrency(Number(t.amount), { signDisplay: "always" })}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-ink-faint">
                    {formatDateFull(t.occurred_at)}
                    {t.account?.name ? ` · ${t.account.name}` : ""}
                  </div>
                  <div className="mt-2 flex items-center gap-1">
                    <CategoryDropdown
                      value={t.category_id}
                      categories={categories}
                      onChange={(id) => applyCategory([t.id], id)}
                      disabled={isPending || isFading}
                    />
                    {t.is_manual_category && (
                      <span className="text-xs text-ink-faint" title="Manually set">
                        ✓
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Desktop (sm+): the full table, contained so it scrolls inside this box
          rather than throwing off the fixed bottom nav. */}
      <div className="hidden overflow-x-auto sm:block">
      <table className="w-full table-fixed text-sm">
        <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
          <tr>
            <th className="py-2 w-6">
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === txns.length}
                onChange={toggleSelectAll}
              />
            </th>
            <th className="hidden w-24 sm:table-cell">Date</th>
            <th>Merchant</th>
            <th className="hidden w-32 sm:table-cell">Account</th>
            <th className="w-48">Category</th>
            <th className="w-24 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {pendingTxns.map((p) => {
            const { isOutflow } = displaySign(Number(p.amount), p.account?.type);
            return (
              <tr key={`pending-${p.id}`} className="border-t border-hairline opacity-60">
                <td className="py-2" />
                <td className="hidden whitespace-nowrap sm:table-cell">
                  {formatDateFull(p.occurred_at)}
                </td>
                <td className="pr-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[10px] font-medium text-ink-muted">
                      {(p.description ?? "?").charAt(0).toUpperCase()}
                    </span>
                    <span className="truncate">{p.description ?? "Pending transaction"}</span>
                  </span>
                </td>
                <td className="hidden truncate sm:table-cell">{p.account?.name ?? "—"}</td>
                <td>
                  <PendingBadge />
                </td>
                <td
                  className={`text-right tabular-nums ${
                    isOutflow ? "text-negative" : "text-positive"
                  }`}
                >
                  {formatCurrency(Number(p.amount), { signDisplay: "always" })}
                </td>
              </tr>
            );
          })}
          {txns.map((t) => {
            const { isOutflow } = displaySign(Number(t.amount), t.account?.type);
            const isPending = pendingIds.has(t.id);
            const isFading = fadingIds.has(t.id);
            return (
              <tr
                key={t.id}
                className={`border-t border-hairline transition-opacity duration-700 ${
                  isFading ? "opacity-40" : "opacity-100"
                }`}
              >
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggleSelect(t.id)}
                    disabled={isFading}
                  />
                </td>
                <td className="hidden whitespace-nowrap sm:table-cell">
                  {formatDateFull(t.occurred_at)}
                </td>
                <td className="pr-2">
                  <span className="flex min-w-0 items-center gap-2">
                    {t.merchant_logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.merchant_logo_url}
                        alt=""
                        className="h-5 w-5 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[10px] font-medium text-ink-muted">
                        {(t.merchant ?? t.description ?? "?").charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="truncate">{t.merchant ?? t.description}</span>
                  </span>
                </td>
                <td className="hidden truncate sm:table-cell">{t.account?.name ?? "—"}</td>
                <td>
                  <CategoryDropdown
                    value={t.category_id}
                    categories={categories}
                    onChange={(id) => applyCategory([t.id], id)}
                    disabled={isPending || isFading}
                  />
                  {t.is_manual_category && (
                    <span className="ml-1 text-xs text-ink-faint" title="Manually set">
                      ✓
                    </span>
                  )}
                </td>
                <td
                  className={`text-right tabular-nums ${
                    isOutflow ? "text-negative" : "text-positive"
                  }`}
                >
                  {formatCurrency(Number(t.amount), { signDisplay: "always" })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}
