import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * INVARIANT GUARD — client writes must bust the Next.js CLIENT Router Cache.
 *
 * Every tab in `bottom-nav.tsx` is a `<Link prefetch>`, which registers a
 * `PrefetchKind.FULL` entry. Next reuses a FULL entry's *whole* RSC payload —
 * no refetch — for `staleTimes.static`, which defaults to 300s (verified in
 * next/dist/server/config-shared.js and prefetch-cache-utils.js). So for five
 * minutes after you visit a tab, navigating back to it re-renders the payload
 * captured BEFORE any writes you made.
 *
 * `revalidateTag`/`revalidateHousehold` inside a Route Handler does NOT fix this:
 * it busts the *server* data cache only. Only a Server Action ships the client
 * router-cache invalidation signal to the browser. A client component that writes
 * via `fetch()` to a Route Handler must therefore call `router.refresh()` itself,
 * or its page silently serves pre-write data on the next navigation.
 *
 * Concrete bug this caught: categorising on /inbox, navigating away, and coming
 * back showed every row as "Uncategorised" again — the write had persisted fine,
 * but the stale prefetched payload still carried `category_id: null`.
 *
 * If this fails: call `router.refresh()` after the successful write, or add a
 * `// router-refresh-exempt: <reason>` marker (e.g. the write feeds nothing any
 * server component renders).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "../../src");

const WRITE_RE = /method:\s*["'`](POST|PATCH|PUT|DELETE)["'`]/;
const MARKER = "router-refresh-exempt";

function listClientComponents(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(srcRoot);
  return out.filter((f) => /^["']use client["']/m.test(readFileSync(f, "utf8")));
}

describe("client router-cache guard", () => {
  it("finds client components to scan", () => {
    expect(listClientComponents().length).toBeGreaterThan(5);
  });

  it("every client component that writes via fetch() also calls router.refresh()", () => {
    const offenders: string[] = [];

    for (const file of listClientComponents()) {
      const text = readFileSync(file, "utf8");
      if (!WRITE_RE.test(text)) continue;
      if (text.includes(MARKER)) continue;
      if (text.includes("router.refresh()")) continue;
      offenders.push(path.relative(srcRoot, file));
    }

    expect(
      offenders,
      `Client component writes to an API route but never calls router.refresh() — the ` +
        `prefetched RSC payload stays stale for staleTimes.static (300s), so navigating ` +
        `away and back re-renders pre-write data:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
