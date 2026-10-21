"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/format";
import type { BalanceAccount, BalancesResult } from "@/lib/accounts/balances";
import { Settings, Check } from "./icons";

/** Name + institution line, with the revolving-credit facilities called out.
 *  A facility's balance is what's DRAWN, so an undrawn one reads $0 — the pill
 *  says why, and the headroom is the figure that carries the meaning. */
function AccountLabel({ account }: { account: BalanceAccount }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-1.5">
        <span className="truncate font-medium text-ink">{account.name}</span>
        {account.isRevolving && (
          <span className="shrink-0 rounded-md bg-sunken px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-muted">
            revolving credit
          </span>
        )}
      </span>
      <span className="block truncate text-[11px] text-ink-faint">
        {account.institution}
        {account.available != null &&
          ` · ${formatCurrency(account.available, { decimals: 0 })} available`}
      </span>
    </span>
  );
}

/**
 * Balances widget for /budgets: current balance per account, with an inline edit
 * mode that picks which accounts appear.
 *
 * Config lives on the widget rather than in Settings so the list you're looking
 * at is the list you edit — one component, one route, nothing to keep in sync
 * with a second screen. Each checkbox saves immediately (optimistic, reverted on
 * failure); the flag is per-account on the server, so it follows the household
 * across devices instead of sitting in this browser's localStorage.
 */
export function BalancesCard({ result }: { result: BalancesResult }) {
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(result.accounts.map((a) => [a.akahuAccountId, a.shown])),
  );
  const [saving, setSaving] = useState<string | null>(null);
  const router = useRouter();

  if (result.accounts.length === 0) return null;

  const visible = result.accounts.filter((a) => shown[a.akahuAccountId]);
  const total = visible.reduce((sum, a) => sum + a.balance, 0);

  async function toggle(a: BalanceAccount) {
    const next = !shown[a.akahuAccountId];
    setSaving(a.akahuAccountId);
    setShown((s) => ({ ...s, [a.akahuAccountId]: next })); // optimistic
    const res = await fetch("/api/accounts/visibility", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ akahuAccountId: a.akahuAccountId, value: next }),
    });
    setSaving(null);
    if (!res.ok) setShown((s) => ({ ...s, [a.akahuAccountId]: !next })); // revert
  }

  function done() {
    setEditing(false);
    // Re-render the server component so the next paint (and any other surface
    // reading balances) matches what was just saved.
    router.refresh();
  }

  return (
    <section className="mb-3 rounded-card bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Balances
        </span>
        <button
          type="button"
          onClick={() => (editing ? done() : setEditing(true))}
          aria-label={editing ? "Done editing balances" : "Choose which accounts to show"}
          className="flex items-center gap-1 rounded-control px-2 py-1 text-[11px] font-semibold text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
        >
          {editing ? (
            <>
              <Check className="h-3.5 w-3.5" /> Done
            </>
          ) : (
            <>
              <Settings className="h-3.5 w-3.5" /> Edit
            </>
          )}
        </button>
      </div>

      {!editing && (
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <span
            className={`text-[26px] font-bold tabular-nums ${
              total < 0 ? "text-negative" : "text-ink"
            }`}
          >
            {formatCurrency(total, { decimals: 0 })}
          </span>
          <span className="text-[11px] text-ink-faint">
            {visible.length} account{visible.length === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {editing ? (
        <>
          <p className="mt-2 text-[12px] text-ink-muted">
            Tick the accounts to show on this card.
          </p>
          <ul className="mt-2 divide-y divide-hairline">
            {result.accounts.map((a) => (
              <li key={a.akahuAccountId}>
                <label className="flex cursor-pointer items-center gap-3 py-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={shown[a.akahuAccountId] === true}
                    disabled={saving === a.akahuAccountId}
                    onChange={() => toggle(a)}
                    className="h-4 w-4 shrink-0 accent-accent"
                  />
                  <AccountLabel account={a} />
                  <span
                    className={`shrink-0 tabular-nums ${
                      a.isLiability ? "text-negative" : "text-ink-muted"
                    }`}
                  >
                    {formatCurrency(a.balance, { decimals: 0, currency: a.currency })}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : visible.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-muted">
          No accounts shown — tap Edit to pick some.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-hairline">
          {visible.map((a) => (
            <li key={a.akahuAccountId} className="flex items-center gap-3 py-2 text-[13px]">
              <AccountLabel account={a} />
              <span
                className={`shrink-0 tabular-nums ${
                  a.isLiability ? "text-negative" : "text-ink"
                }`}
              >
                {formatCurrency(a.balance, { decimals: 2, currency: a.currency })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
