import type { NextResponse } from "next/server";
import { unauthorized } from "./auth";

/**
 * Vercel-cron Bearer check, shared by every `/api/cron/*` route. Returns a 401
 * response to short-circuit on a missing/incorrect secret, or `null` when the
 * request is authorised:
 *
 *   const denied = requireCronAuth(request);
 *   if (denied) return denied;
 *
 * An unset `CRON_SECRET` always denies — never fall back to an empty secret that
 * a bare `Bearer ` header would satisfy.
 */
export function requireCronAuth(request: Request): NextResponse | null {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return unauthorized();
  }
  return null;
}
