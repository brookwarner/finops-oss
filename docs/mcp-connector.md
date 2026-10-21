# FinOps MCP Connector

As of v0.42.0, the endpoint serves MCP `2026-07-28` with SDK v2 and retains
2025 Streamable HTTP compatibility. The experimental budget Events pilot adds
`events/list`, `events/subscribe`, `events/unsubscribe`, `events/poll` and
`get_finops_events`. See [MCP Events](mcp-events.md)
for delivery, replay and consumer setup. The initial tool table below is historical;
use `tools/list` for the current catalog, which includes authenticated write tools.

A remote MCP server at `/api/mcp` that lets you ask Claude — from claude.ai web, the Claude mobile app, Claude Desktop, or Claude Code — questions like *"how am I going on groceries this month?"* and get answers straight from your FinOps data.

Design + plan: [`docs/superpowers/specs/2026-06-03-mcp-connector-design.md`](superpowers/specs/2026-06-03-mcp-connector-design.md), [`docs/superpowers/plans/2026-06-03-mcp-connector.md`](superpowers/plans/2026-06-03-mcp-connector.md).

## Original read tools

| Tool | Args | Returns |
|------|------|---------|
| `get_budget_status` | `category`, `from?`, `to?` | One category: target, net spent, %, remaining, RAG status, days left, recent txns |
| `list_budgets` | `from?`, `to?`, `group?` | All budgets (same numbers as the Budgets page) + flex balance + inbox counts |
| `get_recent_transactions` | `category?`, `limit?`, `since?` | Recent transactions |
| `search_transactions` | `query`, `limit?` | Merchant/description text search |
| `get_net_worth` | — | Assets − liabilities across all accounts |

All numbers come from the same `computeBudgets`/`computeNetWorth` modules the web UI uses, so MCP answers match the app.

## Required environment variables (Vercel project settings)

| Var | Purpose | Example |
|-----|---------|---------|
| `MCP_PUBLIC_URL` | Public base URL of the deployment (no trailing slash) | `https://finops.example.com` |
| `MCP_OAUTH_CLIENT_ID` | Static OAuth client id you paste into Claude | `finops-claude` |
| `MCP_OAUTH_CLIENT_SECRET` | Static OAuth client secret | (random 32+ bytes) |
| `MCP_JWT_SECRET` | HS256 signing secret for access tokens **and** authorization codes | (random 32+ bytes) |

Generate secrets with e.g. `openssl rand -base64 32`. These never go in git — set them in Vercel.

## Auth model

`/api/mcp` accepts **either** credential:

- **OAuth 2.1 + PKCE (S256)** — used by claude.ai web/mobile and Claude Desktop. The server is its own authorization server: it advertises metadata at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`, gates `/api/oauth/authorize` behind the existing Supabase magic-link login, and issues a 15-minute HS256 JWT from `/api/oauth/token`. A single static client is used (no dynamic client registration).
- **Personal access token (PAT)** — a long-lived `fops_…` token for Claude Code. Mint one at **`/settings/tokens`** (copy it once — only the hash is stored). Revoke any time from the same page.

Allowed OAuth redirect URIs: `https://claude.ai/api/mcp/auth_callback` and
`https://claude.com/api/mcp/auth_callback` (Claude),
`https://chatgpt.com/connector_platform_oauth_redirect` (ChatGPT cloud plugins and
Dots), and loopback `http://localhost:<port>/callback` /
`http://127.0.0.1:<port>/callback` on any port (CLI clients).

For ChatGPT, add a custom MCP server at `https://finops.example.com/api/mcp`,
select OAuth with the user-defined client ID `finops-claude`, and token endpoint
auth method `none`. No client secret is required: the token endpoint validates
the client ID and PKCE S256. Authenticate with the household owner's existing
FinOps login, then confirm the plugin discovers `budget.threshold_crossed`.

## Connecting

### claude.ai web (then mobile)
1. Settings → Connectors → **Add custom connector**.
2. URL: `https://<your-domain>/api/mcp`.
3. **Advanced settings** → paste `MCP_OAUTH_CLIENT_ID` and `MCP_OAUTH_CLIENT_SECRET`.
4. Add → complete the OAuth login (Supabase magic link). If you're logged out, you'll sign in and be returned to finish authorizing.
5. The connector then appears in the **Claude mobile app** automatically (adding connectors *on* mobile is still beta; configure on web).

### Claude Desktop
Same as web — Settings → Connectors → Add custom connector, same URL + client id/secret.

### Claude Code
Two options.

**A. Static PAT (simplest)** — mint a token at `/settings/tokens`, then add to `.mcp.json`:
```json
{ "mcpServers": { "finops": {
  "type": "http",
  "url": "https://<your-domain>/api/mcp",
  "headers": { "Authorization": "Bearer fops_…" }
}}}
```

**B. OAuth** —
```bash
claude mcp add --transport http \
  --client-id finops-claude --client-secret <MCP_OAUTH_CLIENT_SECRET> \
  --callback-port 8080 \
  finops https://<your-domain>/api/mcp
```
Claude Code uses an RFC 8252 loopback redirect; the server allows loopback callbacks on any port.

### Codex (OpenAI)

Codex reads `~/.codex/config.toml`. Mint a PAT at `/settings/tokens`, then add:

```toml
[mcp_servers.finops]
enabled = true
url = "https://<your-domain>/api/mcp"
http_headers = { Authorization = "Bearer fops_…" }
```

**Gotcha:** `codex mcp add --url … --bearer-token-env-var <VAR>` takes the *name of an
environment variable*, not the token itself. Pasting the raw `fops_…` value into
`bearer_token_env_var` makes Codex look up an env var by that name, find nothing, send no
`Authorization` header, and get a silent 401. There is a `bearer_token` key in the config
schema but it is rejected for `streamable_http` transports (`bearer_token is not supported
for streamable_http`) — use `http_headers` as above.

OAuth also works (`codex mcp login finops` with `oauth_client_id = "finops-claude"`): Codex
uses an RFC 8252 loopback redirect on `/callback`, which `isAllowedRedirectUri` permits, and
`/api/oauth/token` validates `client_id` + PKCE only, so no client secret is needed.

Verify with:

```bash
codex exec 'Call the finops MCP tool `ping`.'
```

## Verifying

- Unauthenticated probe should 401 with a `WWW-Authenticate` header:
  ```bash
  curl -i -X POST https://<your-domain>/api/mcp \
    -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  ```
- After connecting, ask: *"how am I going on groceries this month?"* — the number should match the Budgets page.

## Notes / follow-ups

- **Net-worth sign convention:** `computeNetWorth` assumes liability balances are stored as positive magnitudes. Confirm against live Akahu data; if liabilities come through negative, adjust `src/lib/networth/compute.ts`.
- Use `tools/list` for the current catalog, including authenticated write tools.
