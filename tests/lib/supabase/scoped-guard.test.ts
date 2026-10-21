import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { HOUSEHOLD_SCOPED_TABLES } from "@/lib/supabase/scoped";

/**
 * INVARIANT GUARD — defense-in-depth household scoping.
 *
 * Every household-scoped table MUST be queried through `scopedDb` (which injects
 * `.eq("household_id", id)`), NOT a raw `supabase.from("<table>")`. The PAT/MCP/CLI
 * service-role client bypasses RLS, so a single forgotten household filter is a
 * cross-household data leak. This test scans the source text and FAILS if any
 * scoped table name appears in a raw `.from("<table>")` outside `scoped.ts` unless
 * the call carries a `// scoped-db-exempt: <reason>` marker on the same line or
 * within the few preceding lines (for genuinely cross-household / by-PK queries:
 * crons that enumerate all households, token resolution, the akahu_config
 * singleton, membership lookups, etc.).
 *
 * If this fails: route the query through `scopedDb(supabase, householdId).<table>`,
 * or — if it is legitimately not household-scoped — add a `scoped-db-exempt`
 * marker with a one-line reason.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "../../../src");

// A raw `.from("table")` / `.from('table')` for one of the scoped tables.
const fromRe = new RegExp(
  String.raw`\.from\(\s*["'\`](` + HOUSEHOLD_SCOPED_TABLES.join("|") + String.raw`)["'\`]\s*\)`,
);

const MARKER = "scoped-db-exempt";
// How many preceding lines an exempt marker may sit above the raw `.from()` and
// still cover it (covers a leading block comment on the statement).
const MARKER_WINDOW = 6;

function listSourceFiles(): string[] {
  // Recursive readdir instead of fs.globSync: `globSync` is not reliably exposed
  // as a named/ESM export across Node versions (e.g. Node 22.22.1 under vitest
  // throws "globSync is not a function"), which silently disabled this guard.
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
  };
  walk(srcRoot);
  return out;
}

describe("scoped-db guard", () => {
  it("finds source files to scan", () => {
    expect(listSourceFiles().length).toBeGreaterThan(20);
  });

  it("never queries a household-scoped table via a raw .from() without a scoped-db-exempt marker", () => {
    const offenders: string[] = [];

    for (const file of listSourceFiles()) {
      // The helper itself is the one place raw `.from()` is allowed.
      if (file.replace(/\\/g, "/").endsWith("lib/supabase/scoped.ts")) continue;

      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!fromRe.test(line)) return;
        const windowText = lines.slice(Math.max(0, i - MARKER_WINDOW), i + 1).join("\n");
        if (windowText.includes(MARKER)) return;
        const rel = path.relative(srcRoot, file);
        offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }

    expect(
      offenders,
      `Raw .from("<scoped table>") without a scoped-db-exempt marker — route through scopedDb or mark exempt:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("guards every table that carries a household_id column", () => {
    // Tripwire: if a new scoped table is added to the list, the guard covers it.
    expect(HOUSEHOLD_SCOPED_TABLES).toContain("transactions");
    expect(HOUSEHOLD_SCOPED_TABLES).toContain("budgets");
    expect(HOUSEHOLD_SCOPED_TABLES).toContain("accounts");
    expect(HOUSEHOLD_SCOPED_TABLES).toContain("holdings");
    expect(HOUSEHOLD_SCOPED_TABLES).toContain("net_worth_snapshots");
    expect(HOUSEHOLD_SCOPED_TABLES).toContain("subscriptions");
    expect(HOUSEHOLD_SCOPED_TABLES).toContain("alerts");
    expect(HOUSEHOLD_SCOPED_TABLES).toContain("category_rules");
    expect(HOUSEHOLD_SCOPED_TABLES).toContain("categories");
  });
});
