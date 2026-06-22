import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { computeNetWorth } from "@/lib/networth/compute";
import { computeForecast } from "@/lib/forecast/compute";
import { loadInvestments } from "@/lib/holdings/investments";
import { summarisePortfolio } from "@/lib/holdings/group";
import { defineTool, householdId, text, type ToolDef } from "./types";

export const networthTools: ToolDef[] = [
  defineTool(
    "get_net_worth",
    "Total assets minus liabilities across all accounts.",
    {},
    async (_args, extra) => {
      const supabase = createSupabaseServiceClient();
      const r = await computeNetWorth({ supabase, householdId: householdId(extra) });
      return text(r);
    },
  ),

  defineTool(
    "get_holdings",
    "Investment & KiwiSaver holdings grouped by account, plus a whole-portfolio " +
      "roll-up. Each account and fund carries its current value, cumulative " +
      "return (returnPct = since purchase) and annualisedPct (compound annual " +
      "growth rate, CAGR). annualisedPct is null when a holding has been tracked " +
      "under ~6 months (too short to annualise honestly) or has no inception date " +
      "set. inceptionSource is 'manual' (an investing-since date the user set) or " +
      "'observed' (earliest sync). The `portfolio` summary blends accounts by NZD " +
      "value (annualisedCoverageNZD < valueNZD means some accounts still need a " +
      "start date). Native-currency caveat: per-fund value/returns are in the " +
      "fund's own currency — balanceNZD is the authoritative per-account NZD figure.",
    {},
    async (_args, extra) => {
      const supabase = createSupabaseServiceClient();
      const accounts = await loadInvestments({ supabase, householdId: householdId(extra) });
      return text({ accounts, portfolio: summarisePortfolio(accounts) });
    },
  ),

  defineTool(
    "get_cashflow_forecast",
    "Forward cashflow forecast (read-only): walks everyday spending cash (Westpac Everyday + ASB Streamline) forward 40 days against projected pay, committed bills, and daily discretionary burn. Returns the daily balance series, the trough (lowest point + date), next payday, the next major bill cluster (billsDue: date + total + count), and a plain verdict on whether the balance covers those bills. Reserves and revolving credit are context only, not part of the runway. Answers 'can I pay my bills?'.",
    {},
    async (_args, extra) => {
      const supabase = createSupabaseServiceClient();
      const r = await computeForecast({ supabase, householdId: householdId(extra) });
      return text(r);
    },
  ),
];
