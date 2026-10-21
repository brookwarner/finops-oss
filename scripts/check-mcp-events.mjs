#!/usr/bin/env node
// Integration smoke test. Creates two isolated fixture households and temporary
// PATs, then deletes them and all cascading fixtures. No Telegram is invoked.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const run = promisify(execFile);
const base = process.argv[2];
if (!base) throw new Error("Usage: node --env-file=.env.local scripts/check-mcp-events.mjs <base-url>");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const eventName = "budget.threshold_crossed";
const fixtures = [];
const scratch = await mkdtemp(join(tmpdir(), "finops-mcp-events-"));
async function checked(query) {
  const { data, error } = await query;
  if (error) throw new Error(`Fixture operation failed (${error.code})`);
  return data;
}
async function rpc(token, method, params = {}, version = "2026-07-28") {
  const response = await fetch(new URL("/api/mcp", base), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json",
      Accept: "application/json, text/event-stream", "MCP-Protocol-Version": version,
      "Mcp-Method": method, ...(method === "tools/call" ? { "Mcp-Name": params.name } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {
      ...params, ...(version === "2026-07-28" ? { _meta: {
        "io.modelcontextprotocol/protocolVersion": version,
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "finops-event-smoke", version: "1" },
      } } : {}),
    } }),
  });
  assert.equal(response.status, 200, `HTTP error for ${method}`);
  const body = await response.text();
  const data = body.split("\n").find(line => line.startsWith("data:"));
  return JSON.parse(data ? data.slice(5) : body);
}
async function call(token, method, params, version) {
  const message = await rpc(token, method, params, version);
  assert.equal(message.error, undefined, `Protocol error for ${method}: ${JSON.stringify(message.error)}`);
  return message.result;
}
async function insertThreshold(household) {
  const [row] = await checked(db.from("alerts").insert({
    household_id: household, type: "cap_warning", state: "warning",
    title: "MCP isolated verification fixture", body: "", period_start: "2026-10-19",
    payload: { target: 100, netSpent: 85, pct: 85 },
  }).select("id"));
  return row.id;
}
try {
  const [member] = await checked(db.from("household_members").select("user_id").limit(1));
  assert.ok(member, "A member is required to own temporary verification tokens");
  for (let i = 0; i < 2; i++) {
    const [household] = await checked(db.from("households").insert({ name: "MCP isolated verification fixture" }).select("id"));
    fixtures.push(household);
    await checked(db.from("household_members").insert({ household_id: household.id, user_id: member.user_id, role: "owner" }));
    const token = "fops_" + randomBytes(32).toString("base64url");
    await checked(db.from("access_tokens").insert({
      household_id: household.id, user_id: member.user_id, name: "Temporary MCP verification",
      token_hash: createHash("sha256").update(token).digest("hex"), prefix: token.slice(0, 12),
    }));
    household.token = token;
  }
  const [a, b] = fixtures;
  const unauthorized = await fetch(new URL("/api/mcp", base), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(unauthorized.status, 401);
  assert.ok(unauthorized.headers.get("www-authenticate")?.includes("oauth-protected-resource"));
  const discovery = await call(a.token, "server/discover", {});
  assert.deepEqual(discovery.capabilities.events, {});
  const tools = await call(a.token, "tools/list", {});
  assert.ok(tools.tools.some(tool => tool.name === "get_finops_events"));
  assert.ok(tools.tools.some(tool => tool.name === "get_cash_allocations"));
  for (const version of ["2026-07-28", "2025-11-25"]) {
    const ping = await call(a.token, "tools/call", { name: "ping", arguments: {} }, version);
    assert.equal(ping.content[0].text, `ok household=${a.id}`);
  }
  const catalog = await call(a.token, "events/list", {});
  assert.deepEqual(catalog.events[0].delivery, ["webhook", "poll"]);
  assert.equal(catalog.events[0].name, eventName);
  const start = await call(a.token, "events/poll", { name: eventName, cursor: null });
  assert.deepEqual(start.events, []);
  const consumerEnv = { ...process.env, FINOPS_TOKEN: a.token, FINOPS_API_URL: base,
    FINOPS_EVENTS_STATE: join(scratch, "cursor.json") };
  const consume = () => run(process.execPath, ["scripts/watch-mcp-events.mjs", "--once"], { env: consumerEnv });
  assert.equal((await consume()).stdout, "");
  const idA = await insertThreshold(a.id);
  const idB = await insertThreshold(b.id);
  const result = await call(a.token, "events/poll", { name: eventName, cursor: start.cursor });
  assert.deepEqual(result.events.map(event => event.eventId), [idA]);
  assert.notEqual(result.events[0].eventId, idB);
  assert.deepEqual(result.events[0].data, { categoryId: null, periodStart: "2026-10-19", state: "warning", target: 100, netSpent: 85, pct: 85 });
  const replay = await call(a.token, "events/poll", { name: eventName, cursor: start.cursor });
  assert.deepEqual(replay.events, result.events);
  const foreign = await rpc(b.token, "events/poll", { name: eventName, cursor: start.cursor });
  assert.equal(foreign.error.code, -32602);
  const tool = await call(a.token, "tools/call", {
    name: "get_finops_events", arguments: { name: eventName, cursor: start.cursor },
  });
  assert.deepEqual(JSON.parse(tool.content[0].text).events, result.events);
  const received = (await consume()).stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  assert.deepEqual(received.map(event => event.eventId), [idA]);
  assert.equal((await consume()).stdout, "");
  const metadata = await (await fetch(new URL("/.well-known/oauth-authorization-server", base))).json();
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);
  console.log(JSON.stringify({ ok: true, serverVersion: discovery.serverInfo?.version,
    protocols: ["2026-07-28", "2025-11-25"], eventCapture: true,
    householdIsolation: true, replay: true, toolFallback: true, consumerCheckpoint: true }));
} finally {
  if (fixtures.length) await checked(db.from("households").delete().in("id", fixtures.map(h => h.id)));
  await rm(scratch, { recursive: true, force: true });
}
