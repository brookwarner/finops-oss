# Dependency security maintenance

Checked on 2026-10-10. GitHub reported 177 open FinOps Dependabot alerts,
including duplicate findings across the pnpm and obsolete npm lockfiles.
The installed pnpm graph initially reported 72 advisories: 7 critical,
27 high, 37 moderate, and 1 low.

Use pnpm 9.12.0, as declared in `package.json` and used by CI. The obsolete
`package-lock.json` has been removed; keep `pnpm-lock.yaml` authoritative.

Updates include Next.js 15.5.27, MCP SDK 1.32.1, Vitest 4.1.11 with Vite
6.4.3, and patched transitive dependencies. Three explicit overrides cover
dependencies whose parents still resolve affected versions:

- `next>postcss`: 8.5.26, retaining Next's PostCSS 8 interface.
- `akahu>uuid`: 11.1.1, retaining the CommonJS `v4()` API Akahu uses for
  idempotency keys. A regression test exercises actual Akahu request preparation
  without sending a bank request.
- `postcss-selector-parser`: 7.1.6, validated by the production CSS build.

`mcp-handler` 1.1.0 still declares an exact MCP SDK 1.26.0 peer. This pre-existing
peer mismatch remains visible; the SDK is kept on its patched version. A real
handler regression test verifies initialization and a tool call. Migrating to
the handler's newer major release requires a separate MCP server migration.

The updated graph reports one high advisory:
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
stack exhaustion in `braces` 3.0.3. There is no published patched version as
of this check. It is pulled in by Tailwind 3's glob/watch dependencies
(`chokidar` and `micromatch`). Keep this finding visible; no audit suppression
or Dependabot dismissal has been added. Revisit when a patch or compatible
upstream replacement is available.

Validation: the existing 785 tests, two new dependency compatibility tests,
TypeScript checks, and a Next.js production build pass. GitHub alerts are
re-evaluated after these lockfile changes reach the default branch; local
audit results do not mean the remote alerts are closed.

For subsequent maintenance, run `pnpm audit`, inspect GitHub's open alerts,
apply compatible fixes, then run `pnpm test`, `pnpm typecheck`, and
`pnpm build`. An audit exits nonzero while the unpatched advisory remains.

BrookOS currently has no third-party Python dependencies, and GitHub reports
that Dependabot alerts are disabled for that repository.

## Local braces mitigation (2026-10-22)

Upstream still publishes no fixed release for GHSA-vfj7-8cjw-p6xm. FinOps now
applies `patches/braces@3.0.3.patch` through pnpm's `patchedDependencies`.
The parser rejects brace/parenthesis nesting deeper than 100 before the
recursive compile/expand walkers run. Both Chokidar and Micromatch resolve
the patched package; ordinary, escaped, quoted, bracketed and long shallow
patterns retain their existing behavior.

`tests/lib/braces-security.test.ts` exercises the installed transitive copies,
including 4,000-level inputs and the accepted depth boundary. The production
build checks Tailwind's real glob pipeline. No dependency versions are faked,
and no advisory is suppressed or dismissed: version-based audit tools may
still flag upstream 3.0.3 despite this local mitigation. Replace the patch with
a compatible fixed upstream release when one becomes available.
