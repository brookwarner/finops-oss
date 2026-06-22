# FinOps — CLAUDE.md
> Lightweight self-hosted personal finance app. Akahu-powered budget tracking + net worth, with PWA, CLI, and MCP surfaces — ask "how am I going on Groceries?" from your phone or via Claude.

---

## What This Is

A personal finance app for NZ bank data. It ingests transactions, balances, holdings, and
liabilities from [Akahu](https://www.akahu.nz/), categorises everything automatically, and
answers the question most budgeting apps make painful: **"have I spent my budget for this
category this month?"**

Three surfaces share one Next.js backend:
- **PWA** (mobile-first, installable to the home screen) — glance to see budgets.
- **CLI** (`finops`) — token-efficient compact output for terminals and AI agents.
- **MCP** (HTTP transport) — for Claude Desktop / Claude Code conversations.

Designed to run on **Vercel + Supabase**. It ships with example seed data only — bring your
own Supabase project and Akahu credentials (see `README.md`).

**Design goal**: ask "how are we going on groceries?" and get an accurate answer in <1s,
without ever having manually categorised a transaction.

---

## Architecture

- **Three surfaces, one API.** PWA, CLI, and MCP all consume the same Next.js API routes.
  Keep business logic in `src/lib/*` — no duplication across surfaces.
- **Auto-categorisation is the core feature.** A layered engine: manual → exact → pattern →
  bank-hint → LLM → inbox. Rules learn continuously. Bootstrap from your own transaction
  history via `scripts/`.
- **Single-user now, multi-user-ready.** Every row carries a `household_id`; Supabase RLS
  enforces access. The household UI isn't built, but the data model doesn't lock it out.
- **Mortgage P&I matters.** Outgoing payments are transfers; bank-posted interest charges are
  expenses. Don't conflate the two.
- **Refunds offset, don't double-count.** Spend is `SUM(-amount)`, so outflows are negative
  and inflows (refunds) positive — a refund in an expense category reduces that category's
  spend total.

---

## Folder Structure

```
finops/
├── CLAUDE.md              ← YOU ARE HERE
├── docs/                  ← mcp-connector.md, brand/
├── src/
│   ├── app/
│   │   ├── (app)/         ← PWA pages: budgets, transactions, inbox, investments, subscriptions, connect, settings
│   │   ├── (auth)/        ← login + auth callback
│   │   └── api/           ← REST routes, mcp, oauth, telegram/webhook, cron/*
│   ├── lib/               ← akahu, budgets, categorise, networth, holdings, homes, alerts, subscriptions, mcp, dedup, transfers, transactions, fi, forecast, mortgage, income, api, auth, supabase
│   └── components/        ← bottom-nav, charts, theme-toggle, etc.
├── cli/                   ← finops CLI (finops.mjs + lib/)
├── supabase/migrations/   ← schema + example seed data
├── scripts/               ← ops helpers (bootstrap rules, imports, icon gen)
├── tests/
└── vercel.json            ← cron schedules
```

---

## Supabase

Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (dev) and your deployment's env vars (prod).
Never commit them. Service-role bypasses RLS — keep it server-side only.

Apply migrations in `supabase/migrations/` via the Supabase CLI or the dashboard SQL editor.

**Generated DB types:** `src/lib/supabase/database.types.ts` is the generated `Database`
schema; all Supabase clients are parameterised `SupabaseClient<Database>` so queries are
type-checked end-to-end. Regenerate after every migration:

```bash
npm run db:types   # supabase gen types typescript --project-id <YOUR_PROJECT_REF>
```

---

## Conventions

- **Stack is Next.js 15 + Vercel + Supabase + Akahu.**
- **Secrets out of git.** Akahu tokens, service-role key, etc. live in env vars only.
- **Bump `version` in `package.json`** on user-visible changes — it renders as a `v<version>`
  label in the PWA header, doubling as a "what's deployed" indicator. Semver: patch for
  fixes, minor for features. Skip for docs/test/internal-only changes.
- **Verify before claiming done.** Run `pnpm test` and `pnpm typecheck`.

---

## Key Files

| File | Description |
|------|-------------|
| `docs/mcp-connector.md` | Read-only MCP connector (`/api/mcp`) setup — OAuth + PAT auth. |
| `.env.example` | All supported env vars (Supabase, Akahu, cron, optional LLM/Telegram/MCP). |
