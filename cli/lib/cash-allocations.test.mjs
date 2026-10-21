import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../finops.mjs", import.meta.url));
const mock = `globalThis.fetch = async (url, options) => {
  console.log(JSON.stringify({ url, method: options.method ?? "GET", body: options.body ? JSON.parse(options.body) : null }));
  return new Response(JSON.stringify({ accounts: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
};`;
function run(args) {
  return spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(mock)}`, cli, ...args], {
    encoding: "utf8", env: { ...process.env, FINOPS_TOKEN: "fixture-token", FINOPS_API_URL: "https://fixture.invalid" },
  });
}
describe("cash allocations CLI", () => {
  it("reads the shared API and lists the command in help", () => {
    const read = run(["cash-allocations"]);
    expect(read.status).toBe(0);
    expect(JSON.parse(read.stdout.split("\n")[0])).toEqual({ url: "https://fixture.invalid/api/cash-allocations", method: "GET", body: null });
    expect(run(["help"]).stdout).toContain("cash-allocations");
  });
  it("passes the file's exact revision and amounts through the write API", () => {
    const dir = mkdtempSync(join(tmpdir(), "cash-allocation-cli-"));
    try {
      const body = { accountId: "example", revision: 3, businessCash: true, wholeAccountLabel: null, pots: [{ label: "Tax", amount: 1234.56 }] };
      const path = join(dir, "plan.json"); writeFileSync(path, JSON.stringify(body));
      const result = run(["cash-allocations", "set", path]);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.split("\n")[0])).toEqual({ url: "https://fixture.invalid/api/cash-allocations", method: "POST", body });
    } finally { rmSync(dir, { recursive: true }); }
  });
  it("requires a plan file before a write", () => {
    const result = run(["cash-allocations", "set"]);
    expect(result.status).toBe(1); expect(result.stderr).toContain("Usage:"); expect(result.stdout).toBe("");
  });
});
