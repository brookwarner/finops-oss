# Expected income: BrookOS → FinOps

BrookOS owns payment expectations. FinOps owns actual bank receipts, balances,
spending, classifications and financial calculations. CRM sales values are not
converted into payments automatically. Agreed future work is not a net-worth asset.

## Contract v1

BrookOS `GET /api/expected-income` exports a complete snapshot. FinOps
`POST /api/expected-income` imports it, using a FinOps PAT in the bearer header.
The household comes from that token, never from the request body.
FinOps `GET /api/expected-income` returns the stored snapshot and sync timestamp;
MCP `get_expected_income` exposes the same stored state.

```json
{
  "schemaVersion": 1,
  "source": "brookos",
  "generatedAt": "2026-10-10T00:00:00+00:00",
  "payments": [{
    "id": "example-milestone-1",
    "label": "Example client: first milestone",
    "dealId": "example-client",
    "amount": 5000,
    "receivedAmount": 2000,
    "currency": "NZD",
    "expectedDate": "2026-10-20",
    "status": "committed",
    "taxRate": 0
  }]
}
```

`amount` is the original expected cash receipt, not an annual deal value.
`receivedAmount` is cumulative confirmed receipts on the same amount basis;
FinOps forecasts only the outstanding remainder. `taxRate` is the existing
explicit inflow adjustment, default zero; this integration adds no tax/GST
calculation. Supply the amount/rate on the basis appropriate to the existing
FinOps forecast. Only NZD is supported; unsupported currencies fail validation
rather than being summed as NZD. Dates are receipt dates, not invoice issue dates.

Stable ids are per payment/milestone, not per client. Allowed statuses:
`committed` (included by default), `speculative` (optional scenario), `settled`
and `cancelled` (excluded). Part payment changes receivedAmount; cancellation
changes status. Keep settled/cancelled records so their changes remain in exports.
No automatic bank matching is added: update receivedAmount/status in BrookOS when
a receipt is confirmed, then sync. Until that update reaches FinOps, a newly
received payment can still appear as outstanding. Never create a second manual
receivable for the same imported payment; remove/migrate any existing duplicate
before enabling the connector.

Each import replaces just this source's snapshot atomically. Empty snapshots
clear imported expectations; they never delete manual receivables. Replaying the
same snapshot is idempotent. Older timestamps, a reused timestamp with different
contents, and overlapping updates return 409. Invalid bodies return 400 and
invalid credentials 401. Failed imports preserve the previous snapshot. The
source timestamp is the latest payment change; syncedAt is its successful import.
GET exposes freshness so callers can distinguish imported expectations from live
BrookOS state. Last successful data remains in use during a connector outage.

## BrookOS authoring and sync

Authenticated `POST /api/expected-income` creates/partially updates a payment by
stable `id`. `GET /api/expected-income` lists the canonical snapshot. MCP tools:
`list_expected_income`, `upsert_expected_income`, `sync_expected_income`.
BrookOS stores payment records in its existing authoritative board_records store
(kind `expected_income`); local files are mirrors when Supabase is configured.
No BrookOS schema change is required.

Saving a payment attempts sync and returns separate save and sync results. A
failed sync does not undo the BrookOS save. Explicit POST to
`/api/expected-income/sync` retries; the same GET endpoint is used by a four-hourly
Vercel cron. Existing browser/agent authentication applies; cron bearer access
is restricted to the sync endpoint and existing /api/sync route.

## Activation order

1. Apply FinOps migration `20261009191123_expected_income_snapshots.sql` and
   regenerate its database types. The table has RLS: household members can read;
   writes use the existing service-side PAT authentication and scopedDb.
2. Deploy both reviewed changes. The original BrookOS checkout has unrelated
   changes; this implementation is in a separate workspace clone.
3. In FinOps classification settings, mark the consulting income category
   **Irregular** or **One-off**. Default mapping is `Business Income`; override
   `EXPECTED_INCOME_CATEGORY` for another category. FinOps refuses to use active
   imported payments if that category still projects as recurring income, avoiding
   double counting with inferred historical pay and recurring budget targets.
4. Set FinOps `EXPECTED_INCOME_ENABLED=true`. It defaults off so deployment before
   migration does not break existing calculations. Reads from an enabled connector
   fail visibly on storage/configuration errors; they do not substitute zero.
5. Set BrookOS `FINOPS_EXPECTED_INCOME_URL` to the deployed FinOps
   `/api/expected-income` endpoint. Use `FINOPS_EXPECTED_INCOME_TOKEN` or its
   existing server-side `FINOPS_TOKEN` PAT. No bank or Supabase credentials cross
   the API boundary. The URL must use HTTPS (localhost HTTP allowed for testing).
6. Create real payment expectations in BrookOS and sync. Verify FinOps GET and
   Position/cashflow/forecast before enabling scheduled use. Existing manual
   receivables and other household income continue through their current paths.

Committed expectations feed the existing cycle Position, cashflow game-plan
(including API/CLI/MCP), and forecast engine. They affect projected cash only;
opening bank balances, historic income, and net worth are unchanged.
Reserve-aware available drawings are managed separately in FinOps Cash allocations; see [cash-allocations.md](cash-allocations.md). BrookOS continues to own payment expectations.
