"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Check } from "@/components/icons";

type State =
  | { kind: "idle" }
  | { kind: "syncing" }
  | { kind: "done"; summary: string }
  | { kind: "error"; message: string };

// Manual full-sync trigger for the settings hub. Fires the same poll + nightly
// ingest the crons run (via the session-authed /api/sync route), then refreshes
// the server components so freshly-pulled data shows up without a hard reload.
export function SyncNowButton() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });

  const syncing = state.kind === "syncing";

  async function run() {
    if (syncing) return;
    setState({ kind: "syncing" });
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error(data?.error ?? `Sync failed (${res.status})`);
      }
      // The route runs in two independent phases; a transaction-poll failure is
      // the only hard error. A nightly (balance/holdings) failure is non-fatal —
      // the transactions still landed.
      if (data?.poll?.error) throw new Error(data.poll.error);

      const posted = data?.poll?.posted ?? 0;
      const categorised = data?.poll?.categorised ?? 0;
      let summary =
        posted > 0
          ? `Pulled ${posted} transaction${posted === 1 ? "" : "s"}` +
            (categorised > 0 ? `, categorised ${categorised}.` : ".")
          : "Up to date — no new transactions.";
      if (data?.nightly?.error) summary += " Balances couldn't refresh — try again shortly.";
      setState({ kind: "done", summary });
      router.refresh();
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  const description =
    state.kind === "syncing"
      ? "Pulling the latest transactions and balances from Akahu…"
      : state.kind === "done"
        ? state.summary
        : state.kind === "error"
          ? state.message
          : "Pull the latest transactions and balances from Akahu now.";

  return (
    <button
      type="button"
      onClick={run}
      disabled={syncing}
      aria-busy={syncing}
      className="flex w-full items-center gap-3.5 rounded-row bg-surface p-4 text-left shadow-row transition-colors hover:bg-sunken disabled:cursor-progress disabled:opacity-80"
    >
      <span className={state.kind === "done" ? "text-positive" : "text-ink-faint"}>
        {state.kind === "done" ? (
          <Check className="h-5 w-5" />
        ) : (
          <RefreshCw className={`h-5 w-5 ${syncing ? "animate-spin" : ""}`} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">
          {syncing ? "Syncing…" : "Sync now"}
        </span>
        <span
          className={`block text-xs ${
            state.kind === "error" ? "text-negative" : "text-ink-muted"
          }`}
        >
          {description}
        </span>
      </span>
    </button>
  );
}
