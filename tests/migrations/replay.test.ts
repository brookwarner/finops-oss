import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// Guards the from-scratch replay path (`supabase db reset`) that every fresh DB
// uses — new dev, fresh cloud project, the demo stack, and OSS users. Two bugs
// silently broke it before and are easy to reintroduce:
//
//   1. Duplicate version tokens. The Supabase CLI keys a migration on the
//      substring BEFORE the first underscore (e.g. `0026` for `0026_alerts.sql`).
//      Two files sharing a token collide on schema_migrations_pkey mid-reset.
//      (Fixed by renaming the later file to a unique numeric token: 00261, etc.)
//   2. Non-numeric version tokens. The CLI requires `<digits>_name.sql` and
//      SILENTLY SKIPS anything else (the old `0015a_...` never applied, so the
//      `curated` rule source was never whitelisted). A skipped schema migration
//      can cascade into a later failure (e.g. RLS on a table that never got made).
//
// Keep this a pure filename check (no DB) so it runs in CI without Docker.
const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations");

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

// The CLI's version = leading token up to the first underscore.
function versionToken(file: string): string {
  return file.split("_")[0];
}

describe("migration filenames replay cleanly", () => {
  it("has at least the known migration set", () => {
    expect(migrationFiles().length).toBeGreaterThan(40);
  });

  it("every version token is purely numeric (else the CLI silently skips it)", () => {
    const offenders = migrationFiles().filter((f) => !/^[0-9]+$/.test(versionToken(f)));
    expect(offenders, `non-numeric version tokens skip on db reset: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no two migrations share a version token (else schema_migrations_pkey collides)", () => {
    const byToken = new Map<string, string[]>();
    for (const f of migrationFiles()) {
      const v = versionToken(f);
      byToken.set(v, [...(byToken.get(v) ?? []), f]);
    }
    const dupes = [...byToken.entries()].filter(([, files]) => files.length > 1);
    const detail = dupes.map(([v, files]) => `${v}: ${files.join(" + ")}`).join("; ");
    expect(dupes, `duplicate version tokens: ${detail}`).toEqual([]);
  });
});
