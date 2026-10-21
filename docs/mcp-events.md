# MCP budget events pilot

FinOps serves MCP revision `2026-07-28` through SDK v2 and `mcp-handler` 2.3.0.
The same endpoint retains stateless Streamable HTTP compatibility for 2025 clients.
OAuth PKCE and personal access tokens remain supported. OAuth authorization
responses now include the issuer parameter and advertise it in metadata.

## Event contract

`budget.threshold_crossed` fires when the existing daily budget alert evaluation
records a move into `warning` or `over`. It is not a transaction-by-transaction
feed. The scheduled evaluation runs at 19:00 UTC, which is 08:00 NZDT the next day
or 07:00 NZST. Recovery markers do not emit events; a later upward crossing does.

The payload contains `categoryId`, `periodStart`, `state`, `target`, `netSpent`
and `pct`. Transaction descriptions and merchant names are excluded.

The alert insert and event capture commit together through a database trigger.
An alert ID is the stable event ID. Events are recorded regardless of Telegram
delivery success whenever the alert row is persisted. There is no historical
backfill. The outbox uses RLS and explicitly denies direct access to anonymous
and authenticated database roles. The MCP service applies verified household
scoping on every query. Sequence allocation is serialized per household until
commit so poll cursors cannot skip uncommitted earlier events.

## Experimental protocol

This implements the poll subset of the evolving MCP Events design sketch,
not a stable core MCP feature. It advertises `capabilities.events: {}` and:

- `events/list`: discover the event type, schemas and `delivery: ["poll"]`.
- `events/poll`: pass `name: "budget.threshold_crossed"`, `arguments: {}` and
  `cursor: null` to start from now. Persist the returned cursor for later calls.
- Optional `arguments.categoryId` restricts the feed to one category. A cursor
  is bound to the authenticated household and exact category filter.
- `maxEvents` defaults to 50 and is capped at 100. Drain pages immediately while
  `hasMore` is true, otherwise respect `nextPollMs` (60 seconds).
- `maxAgeMs` defaults to seven days and cannot exceed seven days. `truncated`
  indicates a cursor older than that window. Expired events are skipped.

The endpoint uses the standard per-request protocol metadata and HTTP headers
required by the new SDK. Replaying the same cursor may return the same events;
consumers must deduplicate on `eventId`. Cursors are opaque positions, not
authorization credentials. They must not be shared across households or filters.
Webhook subscriptions are available for Dots and ChatGPT Work. Push streams are
not implemented. Polling remains available for other consumers.

Existing clients can use the ordinary `get_finops_events` MCP tool with the same
arguments. Calling the tool does not schedule polling or wake a chat.

## Reference consumer

```sh
# Uses FINOPS_TOKEN or the existing finops CLI login.
node scripts/watch-mcp-events.mjs --once

# Keep polling and emit event occurrences as NDJSON.
node scripts/watch-mcp-events.mjs
```

`FINOPS_API_URL` selects the server; `FINOPS_EVENTS_STATE` selects the cursor file
(default `~/.config/finops/events-cursor.json`). Run only one consumer per cursor
file. The first call establishes the starting position and emits nothing.
The consumer checkpoints after writing output. A downstream agent worker must
durably accept events, deduplicate IDs and decide when to invoke the model.
Writing to stdout alone does not prove downstream processing or exactly-once
delivery. Errors stop the consumer without advancing its cursor.

## Dots and ChatGPT Work

Dots requires webhook delivery, rather than polling. FinOps implements
`events/subscribe` and `events/unsubscribe` on the authenticated MCP endpoint.
Rescan the FinOps plugin after deployment so its events catalog includes
`delivery: ["webhook", "poll"]`. Then tell your dot:

> Subscribe to FinOps budget.threshold_crossed events for all my budgets. When
> an event arrives, read the affected budget and recent transactions, explain
> what changed, and tell me if anything needs my attention. Keep updates brief
> and do not change budgets, categorisation, or move money. Deduplicate events
> by eventId. Keep the subscription renewed.

Dots supplies its own callback URL and signing secret through `events/subscribe`.
Those values cannot be invented or replaced with a regular chat URL. Confirm
that an active row exists in `mcp_event_subscriptions` before calling monitoring
active. A delivered webhook with a 2xx response proves callback receipt, while
an actual response from Dots proves that the agent ran.

Subscriptions expire after 24 hours; the client renews before `refreshBefore`.
Re-registering the same owner, callback and category preserves progress. New
webhook subscriptions start at the current outbox head. Webhooks return
`cursor: null` and do not offer interruption replay after subscription expiry.
The polling cursor and its seven-day replay are independent.

Callbacks are verified using a signed, random challenge before activation.
Verification is cached for one hour per owner, callback and signing key. Every
connection resolves and validates public addresses, pins the socket to the
validated IP, checks TLS against the original host, and refuses redirects.
Only HTTPS port 443 is accepted. Signing secrets are encrypted at rest with
AES-256-GCM using a domain-separated key derived from `MCP_JWT_SECRET`, which
must be at least 32 bytes. Rotating that key requires renewing subscriptions
with their signing secrets; remove the old rows before doing so.

`/api/cron/mcp-events` runs every minute under `CRON_SECRET`. It claims a durable
90-second lease, checks household membership and PAT revocation, and delivers
matching events in sequence using Standard Webhooks signatures. It checkpoints
each 2xx acknowledgement. A process crash between receipt and checkpoint can
repeat the same event ID, so the receiver must deduplicate. Delivery retries use
exponential backoff from one minute to one hour, with eight attempts. HTTP 410
expires the subscription; HTTP 413 is terminal for that event. Exhausted events
advance the checkpoint, increment `failed_count`, and log the subscription and
event IDs for operator investigation. Callback URLs and signing secrets are
never written to application logs.

The dispatcher runs in Vercel; no local computer needs to stay awake. Budget
evaluation remains daily at 08:00 NZDT, with webhook dispatch normally within
one minute afterward. Connecting the plugin alone does not create a Dots
subscription. Clients without webhook event support still need their own
polling consumer.

## Verification

`node --env-file=.env.local scripts/check-mcp-events.mjs <base-url>` checks the
complete flow using two isolated fixture households and temporary PATs. It tests
both protocol generations, event capture, household isolation, replay, the tool
fallback and a consumer checkpoint across separate process runs. Fixtures are
deleted in `finally`; the test never invokes Telegram or edits real budgets.
Run it only against an authorized database and its matching app deployment.

`FINOPS_WEBHOOK_INTEGRATION=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/lib/mcp/webhooks.integration.test.ts`
verifies durable capture, concurrent claims, signed callback verification,
household isolation, retry, renewal and unsubscribe on two isolated disposable
households. Its callback transport is simulated; it does not wake Dots, send
Telegram, or edit real budgets. Run this isolated test before activating real
subscriptions because the dispatcher claims globally due work.

The pilot retains outbox rows in the database, although replay is capped at seven
days. Add a retention job before expanding event volume. To roll back the app,
restore the previous deployment; the additive outbox schema can remain in place.
To disable capture, drop only the `capture_mcp_budget_event` trigger on `alerts`.
