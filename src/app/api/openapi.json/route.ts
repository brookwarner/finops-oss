import { NextResponse } from "next/server";
import { generateOpenApi } from "@/lib/api/openapi/generate";

export const dynamic = "force-dynamic";

/** GET /api/openapi.json — public, unauthenticated OpenAPI 3.1 description of the
 *  REST contract. Shape only, no data. */
export function GET() {
  return NextResponse.json(generateOpenApi());
}
