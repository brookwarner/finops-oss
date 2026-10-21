# FinOps

A lightweight, self-hosted personal finance app for New Zealand bank data. It ingests
transactions, balances, holdings, and liabilities from [Akahu](https://www.akahu.nz/)
(NZ open banking), auto-categorises everything, and answers the one question most budgeting
apps make painful: **"have I spent my budget for this category this month?"**

Three surfaces share one Next.js backend:

- **PWA** — mobile-first, installable to your home screen; glance to see budgets.
- **CLI** (`finops`) — compact, token-efficient output for terminals and AI agents.
- **MCP** (HTTP transport) — connect Claude Desktop / Claude Code to ask about your finances.

> This is a personal project released as a reference/template. It ships with **example seed
> data only** — no real financial data. You bring your own Supabase project and Akahu
> credentials. See [Setup](#setup).

## Features

- **Auto-categorisation** — manual → exact → pattern → bank-hint → LLM → inbox engine, with
  continuous learning. Bootstrap rules from your own transaction history (`scripts/`).
- **Monthly-cap budgets** with refund netting and a Position (in/out/on-pace) view.
- **Net worth** including manual assets (e.g. a home tracked via homes.co.nz) and a mortgage
  principal/interest split.
- **Investments** — holdings ingest + net-worth snapshots, an FI projection, and an
  interactive mortgage what-if scenario panel.
- **Subscription radar** — discretionary recurring-charge detection.
- **Alerts** — optional Telegram pipeline (cap breaches, reserve withdrawals, weekly digest)
  plus conversational write-back.

## Stack

Next.js 15 (App Router) · Supabase (Postgres + RLS) · Akahu · Vercel · TypeScript.

The data model is single-user today but household-ready: every row carries a `household_id`
and RLS enforces access, so multi-member support is additive.

## Setup

1. **Clone + install**
   ```bash
   pnpm install
   cp .env.example .env.local   # fill in values
   ```

2. **Supabase** — create a project, then apply the migrations in `supabase/migrations/`
   (via the Supabase CLI or dashboard SQL editor). Set the `NEXT_PUBLIC_SUPABASE_*` and
   `SUPABASE_SERVICE_ROLE_KEY` vars. The seed migrations install **example** categories and
   categorisation rules — replace them with your own.

3. **Akahu** — create a [personal app](https://developers.akahu.nz/), then set
   `AKAHU_APP_TOKEN`, `AKAHU_APP_SECRET`, and `AKAHU_USER_TOKEN`.

4. **Run**
   ```bash
   pnpm dev          # http://localhost:3000
   pnpm test         # vitest
   pnpm typecheck    # tsc --noEmit
   ```

5. **Deploy** — push to a Vercel project. Configure the env vars in Vercel settings; cron
   schedules live in `vercel.json`.

Optional integrations (Anthropic LLM categorisation fallback, Telegram alerts, MCP) are all
gated behind their own env vars — leave them unset to disable.

## Changelog

A condensed history of notable releases. The `v<version>` label renders in the PWA header.

- **0.28.0** — Loan amortisation interest is now time-based (Actual/365), correct for
  fortnightly/weekly/irregular repayments, not just monthly. A loan can carry its own "as of"
  anchor date. The home-value refresh is fully config-driven (set a property id + account key,
  or leave it off). Currency default is configurable (`DEFAULT_CURRENCY`).
- **0.27.0** — **Expected inflows**: track one-off money you're owed (tax refund, bonus, late
  invoice, bond refund) as a first-class `receivable` asset, each with a likelihood
  (likely/uncertain), an expected date, and an optional pre-tax rate. The cashflow game-plan
  lands each inflow net of its own tax; net worth counts likely receivables and excludes
  uncertain ones. A per-account "revolving facility" flag feeds credit headroom.
- **0.26.0** — **Amortising liabilities**: link a manual loan to a budget category + interest
  rate so it auto-reduces as real repayments post.
- **0.25.0** — **Generalised manual assets**: track assets and liabilities bank feeds can't
  see (a home, money owed to you, private holdings) across PWA, API, CLI, and MCP.
- **0.23–0.24** — Credit-aware cashflow game-plan: each scenario line continues past $0 cash
  into a revolving facility and ends at the credit-maxed wall; distinct line colours, a hover
  crosshair/tooltip, and dated one-off inflows.
- **Earlier** — Forward cashflow forecast, financial-independence projection, subscription
  radar, mortgage principal/interest dashboard + fix/float what-if scenarios, reserve accrual
  with a sweep nudge, a Telegram alerts pipeline with conversational write-back, and the
  layered auto-categorisation engine with monthly-cap budgets.

## License

MIT — see [LICENSE](LICENSE).
