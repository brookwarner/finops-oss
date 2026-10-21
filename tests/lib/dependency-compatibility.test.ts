import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

describe("security dependency compatibility", () => {
  it("supports MCP initialization and tool calls through the real handler", async () => {
    const handler = createMcpHandler((server) => {
      server.registerTool("dependency_probe", { description: "Compatibility probe", inputSchema: z.object({}) }, async () => ({
        content: [{ type: "text", text: "ok" }],
      }));
    });
    const invoke = async (method: string, params: object) => {
      const response = await handler(new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }));
      expect(response.status).toBe(200);
      const body = await response.text();
      const data = body.split("\n").find((line) => line.startsWith("data: "));
      return JSON.parse(data ? data.slice(6) : body);
    };
    const initialized = await invoke("initialize", {
      protocolVersion: "2025-03-26", capabilities: {},
      clientInfo: { name: "dependency-test", version: "1" },
    });
    expect(initialized.result.capabilities.tools).toBeDefined();
    const called = await invoke("tools/call", { name: "dependency_probe", arguments: {} });
    expect(called.result.content).toEqual([{ type: "text", text: "ok" }]);
  });

  it("generates Akahu idempotency keys with the patched CommonJS uuid", () => {
    // Exercise Akahu's actual CommonJS dependency resolution and request preparation.
    // No request is sent to the banking API.
    const require = createRequire(import.meta.url);
    const { AkahuClient } = require("akahu");
    const client = new AkahuClient({ appToken: "app_token_dependency_test" });
    const prepared = client._makeIdempotent({ method: "POST" }, {});
    expect(prepared.headers["Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(client._makeIdempotent({ method: "POST" }, {
      idempotencyKey: "preserved-key",
    }).headers["Idempotency-Key"]).toBe("preserved-key");
  });
});
