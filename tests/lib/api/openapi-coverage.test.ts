import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { registry, OUT_OF_SCOPE } from "@/lib/api/openapi/registry";

function routeDirs(base: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(base, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...routeDirs(join(base, e.name), join(prefix, e.name)));
    else if (e.name === "route.ts") out.push(prefix);
  }
  return out;
}

describe("openapi registry coverage", () => {
  const all = routeDirs("src/app/api");
  const documented = new Set(registry.map((r) => r.path.replace(/^\/api\//, "")));
  const skip = new Set(OUT_OF_SCOPE);

  it("every public route is documented or explicitly out of scope", () => {
    const undocumented = all.filter((p) => !documented.has(p) && !skip.has(p));
    expect(undocumented).toEqual([]);
  });

  it("no registry entry points at a missing route", () => {
    const present = new Set(all);
    const dangling = [...documented].filter((p) => !present.has(p));
    expect(dangling).toEqual([]);
  });
});
