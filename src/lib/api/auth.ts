import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveCredential } from "@/lib/mcp/auth";
import { type ZodType, type ZodError, type infer as ZodInfer } from "zod";

export interface ApiIdentity {
  supabase: SupabaseClient;
  householdId: string;
  userId: string;
}

/** The canonical 401 body shared by every authed route (PAT + cron). */
export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/**
 * Authenticate a CLI / programmatic REST request via a PAT (or OAuth bearer).
 *
 * These routes are the shared contract behind the `finops` CLI and any other
 * non-cookie client. Auth mirrors the MCP route: a `fops_`-prefixed personal
 * access token (or OAuth JWT) in the `Authorization: Bearer` header resolves to
 * a household, and we hand back a service-role client scoped to that household.
 *
 * Returns null on missing/invalid credentials — callers should 401.
 */
export async function authenticateRequest(request: Request): Promise<ApiIdentity | null> {
  const supabase = createSupabaseServiceClient();
  const identity = await resolveCredential(
    request.headers.get("authorization") ?? undefined,
    supabase,
  );
  if (!identity) return null;
  return { supabase, householdId: identity.householdId, userId: identity.userId };
}

/**
 * Wrap a PAT-authenticated GET handler: resolve the bearer credential once, 401
 * on a missing/invalid token, and hand the verified identity to the inner
 * handler. Collapses the `const auth = …; if (!auth) return …` prelude every
 * public REST route (the `finops` CLI / MCP contract) repeated.
 *
 *   export const GET = withAuth(async (request, auth) => { … });
 */
export function withAuth(
  handler: (request: Request, auth: ApiIdentity) => Promise<Response> | Response,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const auth = await authenticateRequest(request);
    if (!auth) return unauthorized();
    return handler(request, auth);
  };
}

export interface RequestSchemas {
  query?: ZodType;
  body?: ZodType;
  params?: ZodType;
}

type Parsed<S extends RequestSchemas> = {
  query: S["query"] extends ZodType ? ZodInfer<S["query"]> : undefined;
  body: S["body"] extends ZodType ? ZodInfer<S["body"]> : undefined;
};

function badRequest(error: ZodError): NextResponse {
  return NextResponse.json(
    { error: "invalid request", issues: error.issues },
    { status: 400 },
  );
}

/** Parse a request's query + JSON body against the given schemas. */
export async function parseRequest<S extends RequestSchemas>(
  request: Request,
  schemas: S,
): Promise<{ ok: true; data: Parsed<S> } | { ok: false; response: NextResponse }> {
  const out: { query?: unknown; body?: unknown } = {};
  if (schemas.query) {
    const q = Object.fromEntries(new URL(request.url).searchParams);
    const r = schemas.query.safeParse(q);
    if (!r.success) return { ok: false, response: badRequest(r.error) };
    out.query = r.data;
  }
  if (schemas.body) {
    const raw = await request.json().catch(() => ({}));
    const r = schemas.body.safeParse(raw);
    if (!r.success) return { ok: false, response: badRequest(r.error) };
    out.body = r.data;
  }
  return { ok: true, data: out as Parsed<S> };
}

/** Bearer-auth + request validation in one wrapper. */
export function withValidated<S extends RequestSchemas>(
  schemas: S,
  handler: (
    request: Request,
    ctx: { auth: ApiIdentity; input: Parsed<S> },
  ) => Promise<Response> | Response,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const auth = await authenticateRequest(request);
    if (!auth) return unauthorized();
    const parsed = await parseRequest(request, schemas);
    if (!parsed.ok) return parsed.response;
    return handler(request, { auth, input: parsed.data });
  };
}
