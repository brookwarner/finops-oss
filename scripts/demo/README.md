# Demo mode (synthetic data, no real financial data)

Stand up a **local, throwaway** FinOps instance with realistic *synthetic* data so
the app can be demoed without any of the owner's real bank data. Everything runs
against a local Docker Postgres — production Supabase is never touched.

## Prerequisites
- Docker Desktop running
- `supabase` CLI installed
- Node 18+ (`@supabase/supabase-js` is already a project dependency)

## One command

```bash
scripts/demo/up.sh
```

This will:
1. Stage the migrations (`build_schema.mjs`) — now a **verbatim copy**. The canonical
   migrations replay cleanly on an empty DB on their own: the the owner-specific data
   seeds are guarded (`if not exists (household …) then return`), so they no-op
   against the demo's synthetic household. (The script stays as a thin seam in case
   the demo ever needs to diverge from prod migrations again.)
2. Spin up an **isolated** local Supabase stack in `~/.finops-demo` (project id
   `finops-demo`) on **remapped ports** (543xx → 544xx) and apply that schema. This
   never touches your git checkout (safe while other sessions commit here) and
   coexists with any other local Supabase stack already running on the default ports.
3. Write local creds to `.env.demo.local` (gitignored).
4. Seed a demo household with synthetic data (`seed_demo.mjs`): generic category
   taxonomy + budgets, 4 accounts, ~6 months of NZ transactions, holdings, and a
   net-worth trend. Idempotent — safe to re-run.

## Run the app against the demo

```bash
set -a; source .env.demo.local; set +a
npm run dev        # or: pnpm dev
```

Open http://localhost:3000.

### Logging in
The app uses **magic-link** auth. Locally there is no real email — the link lands in
the bundled mail catcher. Run `supabase status` and open the **Mailpit/Inbucket URL**,
then:
1. On `/login`, enter the demo email (`demo@finops.local` by default).
2. Open the newest message in the mail catcher and click its login link.

Override the demo identity with `DEMO_EMAIL` / `DEMO_PASSWORD` env vars before `up.sh`.

## Re-seed / tear down
- Re-run `scripts/demo/up.sh` (or just `node scripts/demo/seed_demo.mjs` after sourcing
  `.env.demo.local`) to refresh data.
- Tear the local stack down with: `(cd ~/.finops-demo && supabase stop)`.

## Pointing at a hosted demo project instead
`seed_demo.mjs` refuses to write to a `*.supabase.co` URL unless `DEMO_ALLOW_REMOTE=1`
is set — a guard against accidentally seeding production. If you create a *dedicated*
throwaway cloud project, apply the cleaned schema there, set its creds +
`DEMO_ALLOW_REMOTE=1` in `.env.demo.local`, and run the seed.
