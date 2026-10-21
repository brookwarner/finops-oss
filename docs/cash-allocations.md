# Cash allocations

Open **Settings → Cash allocations**, or the **Cash allocations** link on the
budgets card. For each active NZD checking, savings or wallet account:

1. Select **Include in business cash** for the accounts used to pay yourself.
2. Add named amounts such as Income tax, GST, Upcoming costs and Operating buffer.
   Alternatively protect a **whole account** dedicated to one purpose.
3. Save. The budgets card shows business cash minus saved protection.

For example, $20,000 of business cash with $2,000 GST, $4,000 income tax, $3,000
upcoming costs and $5,000 operating buffer leaves $6,000 available to draw.
Amounts come from the user's own estimates or accounting records. There are no
assumed percentages, automatic liability calculations, or automatic transfers.
The result is cash left after the allocations entered, not a guarantee that all
future obligations have been covered. Allocate costs and a buffer before drawing.

## How money is counted

- Available drawings use current signed business-account balances. Overdrafts
  reduce the total; available credit and unpaid invoices never increase it.
- Fixed allocations remain protected when the account cannot fund them. The
  account shows its shortfall, available drawings floor at zero, and forecasts
  retain the negative unallocated balance rather than pretending an obligation
  disappeared. Business accounts form one pool; transfer cash between them when
  an individual account is short.
- Whole-account protection follows its current positive balance. Existing
  reserve-buffer or emergency-fund designations take precedence over manual
  allocations so the account is protected once.
- Bank balances, transfers, income history and net worth are unchanged. Cashflow
  starts with active NZD liquid cash minus protection. The everyday forecast
  deducts only protection in its existing everyday-account pool. Expected-income
  inflows continue through their existing per-inflow tax adjustment.
- Savings allocated to obligations are carved out of the FI asset stock, capped
  at the positive account balance. Future FI contributions are not inferred from
  cash accounts with active allocations: their transfer history cannot reliably
  distinguish replenishing tax/cost reserves from long-term saving. Unallocated
  accounts continue through the existing FI contribution calculation.
- Allocations cover cash already held. They do not automatically reserve part of
  future invoices or future deposits into a dedicated account in forecast
  scenarios; update fixed amounts as receipts arrive. Whole-account protection
  updates when the actual bank balance refreshes. It is not a future tax model.
- A payment is not automatically matched to an allocation. After paying an
  obligation, reduce or remove its allocation; the bank debit and release then
  offset rather than deducting the same money twice. A bill also represented in
  the forecast remains conservatively reserved until released—no guessed matching.
- Inactive accounts are not offered as new cash sources. Saved plans whose
  accounts become inactive, change currency/type or lose their balance remain
  visible for reconciliation. Available drawings become unavailable and forecast
  calculations fail visibly. Clear the plan or restore the account; no stale
  obligation is silently dropped. Balance timestamps are shown in the editor.

## Shared API, CLI and MCP

`GET /api/cash-allocations` returns account balances, saved configs and revisions,
protected/unallocated amounts, business drawings and any reconciliation issues.

`POST /api/cash-allocations` atomically replaces one account's plan:

```json
{
  "accountId": "the-account-uuid-from-GET",
  "revision": null,
  "businessCash": true,
  "wholeAccountLabel": null,
  "pots": [{ "label": "Income tax", "amount": 4000 }]
}
```

Use `revision: null` only for a new plan; subsequent writes must use the current
revision returned by GET or the previous save. Conflicting writes return **409**.
Use a purpose string plus empty `pots` for whole-account protection. To clear a
plan, use `businessCash: false`, `wholeAccountLabel: null`, and `pots: []`.
Clearing remains available even after an account becomes incompatible.

CLI: `finops cash-allocations` reads the complete state;
`finops cash-allocations set plan.json` saves that JSON body. MCP uses
`get_cash_allocations` and `set_cash_allocations` with the same contract and
calculation. Authenticated identity determines the household, never the body.

## Deployment and verification

Apply `20261010075000_cash_allocations.sql` before deploying v0.41.0. It adds an
account-scoped table with RLS, a composite household/account foreign key and
database validation of labels and monetary amounts. It changes no balances and
creates no personal allocations. Regenerate Supabase types after applying.

Unit/route tests cover money conservation, shortfalls, protection overlap,
overdrafts, reconciliation, household scoping, conflicting writes and cache
invalidation. Run `scripts/check-cash-allocation-rls.mjs` with an installed PGlite
module path to verify migration replay and allow/deny behavior for member CRUD,
other households, anonymous callers and privileged cross-household references.
