# finops CLI

Token-efficient terminal client for the FinOps API. A thin wrapper over the
same `/api/*` routes the PWA and MCP consume — no business logic lives here.

Built for glancing at budgets from a terminal (and for Claude to read compact
output inside a shell).

## Install

Zero dependencies, pure Node (≥18, uses built-in `fetch`). Link it onto your PATH:

```bash
# from the repo root
chmod +x cli/finops.mjs
ln -sf "$PWD/cli/finops.mjs" ~/.local/bin/finops   # or anywhere on PATH
```

## Auth

Mint a personal access token in the PWA (**Settings → Tokens**), then:

```bash
finops login fops_xxxxxxxxxxxx                    # saves to ~/.config/finops/config.json (0600)
finops login fops_xxxxxxxxxxxx http://localhost:3000   # override API URL too
```

Or use env vars (handy for CI / one-offs):

```bash
export FINOPS_TOKEN=fops_xxxxxxxxxxxx
export FINOPS_API_URL=https://finops.example.com   # default
```

## Commands

```bash
finops budget                 # all budgets for the current 20th→20th cycle
finops budget groceries       # one category — "Groceries: $340 of $1,200 (28%), 18 days left. On pace: $567 projected."
finops budget --group Living  # filter by group
finops budget --from 2026-05-01 --to 2026-06-01
finops review                 # transactions awaiting categorisation (--limit N)
finops net-worth              # assets − liabilities, with per-account breakdown
finops <cmd> --json           # raw JSON for any command
```

## Endpoints used

| Command | Route |
|---------|-------|
| `budget` | `GET /api/budgets` |
| `review` | `GET /api/review` |
| `net-worth` | `GET /api/net-worth` |

All authenticate with the `fops_` PAT via `Authorization: Bearer`, the same
credential the MCP route accepts.
