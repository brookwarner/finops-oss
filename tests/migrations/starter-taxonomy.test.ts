import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The starter-taxonomy migration (0049) seeds a generic taxonomy + national-chain
// rules on household creation, so OSS users / new devs get working auto-cat with
// no PocketSmith import. Its one silent failure mode: a rule references a category
// name that the taxonomy doesn't define — the SQL `join … on c.name = r.cat_name`
// then drops that rule with NO error, quietly shrinking coverage. This test reads
// the migration and asserts every rule's target category exists, so a typo or a
// renamed category fails CI instead of silently losing a rule.
const SQL = readFileSync(
  join(__dirname, "..", "..", "supabase", "migrations", "0049_starter_taxonomy.sql"),
  "utf8",
);

// The migration has two `(values …)` blocks: the taxonomy (4-tuples) and the
// rules (2-tuples: merchant, cat_name). Pull the category names from each.
function block(after: string): string {
  const start = SQL.indexOf(after);
  if (start === -1) throw new Error(`anchor not found: ${after}`);
  const open = SQL.indexOf("(values", start);
  // Balance parens from `(values` to the matching close.
  let depth = 0;
  for (let i = open; i < SQL.length; i++) {
    if (SQL[i] === "(") depth++;
    else if (SQL[i] === ")") {
      depth--;
      if (depth === 0) return SQL.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced (values after ${after})`);
}

// First column of every `('…', …)` row in a values block. PG escapes a literal
// quote by doubling it (''), so un-double before comparing.
function firstColumns(valuesBlock: string): string[] {
  return [...valuesBlock.matchAll(/\(\s*'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
}
// Second column (the cat_name) of each rule row.
function secondColumns(valuesBlock: string): string[] {
  return [...valuesBlock.matchAll(/\(\s*'(?:[^']|'')*'\s*,\s*'((?:[^']|'')*)'/g)].map((m) =>
    m[1].replace(/''/g, "'"),
  );
}

const taxonomyNames = new Set(firstColumns(block("Generic taxonomy")));
const ruleCategoryNames = secondColumns(block("National-chain starter rules"));

describe("0049 starter taxonomy", () => {
  it("defines a non-trivial taxonomy and rule set", () => {
    expect(taxonomyNames.size).toBeGreaterThanOrEqual(30);
    expect(ruleCategoryNames.length).toBeGreaterThanOrEqual(40);
  });

  it("every starter rule targets a category the taxonomy defines", () => {
    const missing = [...new Set(ruleCategoryNames)].filter((n) => !taxonomyNames.has(n));
    expect(missing, `rule category names with no matching category: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps 'Online Services' so the subscription radar has its category", () => {
    expect(taxonomyNames.has("Online Services")).toBe(true);
  });
});
