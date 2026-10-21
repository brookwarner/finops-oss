#!/usr/bin/env node
// A bounded reference consumer for the experimental poll mode. It emits NDJSON
// for an agent worker to consume; it does not invoke a model or send messages.
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

let config = {};
try { config = JSON.parse(await readFile(join(homedir(), ".config/finops/config.json"), "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const token = process.env.FINOPS_TOKEN || config.token;
if (!token) throw new Error("Set FINOPS_TOKEN or run finops login before consuming events.");
const endpoint = new URL("/api/mcp", process.env.FINOPS_API_URL || config.apiUrl || "https://finops.example.com");
if (endpoint.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(endpoint.hostname)) {
  throw new Error("Remote event endpoints require HTTPS.");
}
const statePath = resolve(process.env.FINOPS_EVENTS_STATE || join(homedir(), ".config/finops/events-cursor.json"));
let cursor = null;
try {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  if (state.endpoint !== endpoint.href) throw new Error("Cursor belongs to another endpoint; use a separate FINOPS_EVENTS_STATE file.");
  cursor = state.cursor;
} catch (error) { if (error.code !== "ENOENT") throw error; }
const once = process.argv.includes("--once");
do {
  const method = "events/poll";
  const response = await fetch(endpoint, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json",
      Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {
      name: "budget.threshold_crossed", arguments: {}, cursor,
      _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "finops-events-consumer", version: "1" },
        "io.modelcontextprotocol/clientCapabilities": {} },
    } }),
  });
  if (!response.ok) throw new Error(`Event poll failed: HTTP ${response.status}`);
  const body = await response.text();
  const message = response.headers.get("content-type")?.includes("text/event-stream")
    ? JSON.parse(body.split("\n").find(line => line.startsWith("data:"))?.slice(5) || "null") : JSON.parse(body);
  if (!message?.result || message.error) throw new Error(`Event poll failed: protocol error ${message?.error?.code ?? "invalid response"}`);
  const result = message.result;
  if (result.truncated) process.stderr.write("Event replay was truncated by the replay age limit.\n");
  for (const event of result.events) {
    await new Promise((ok, reject) => process.stdout.write(JSON.stringify(event) + "\n", error => error ? reject(error) : ok()));
  }
  cursor = result.cursor;
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
  const temporary = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ endpoint: endpoint.href, cursor }) + "\n", { mode: 0o600 });
  await rename(temporary, statePath);
  if (!once && !result.hasMore) await new Promise(ok => setTimeout(ok, Math.max(1000, result.nextPollMs)));
} while (!once);
