#!/usr/bin/env node

// Stage the canonical migrations for the demo stack.
//
// This used to massage the migrations into a clean-replay set (drop the
// the owner-specific seeds, strip a seed do-block, rename duplicate version
// prefixes, guard the reserve_balance rename). All of that is now baked into
// the canonical migrations themselves — they replay cleanly from scratch via
// `supabase db reset` — so this step is a verbatim copy. The the owner-seed
// migrations are guarded (`if not exists (household …) then return`), so they
// no-op against the demo's synthetic household; no transform required.
//
// Kept as a thin seam: if the demo ever needs to diverge from prod migrations
// again, this is where that belongs.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SRC = arg("--src", "supabase/migrations");
const OUT = arg("--out", "scripts/demo/.migrations");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC)
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const f of files) {
  writeFileSync(join(OUT, f), readFileSync(join(SRC, f)));
}

console.log(`build_schema: ${files.length} migrations copied verbatim to ${OUT}`);
