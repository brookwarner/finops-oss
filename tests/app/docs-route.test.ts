import { describe, it, expect } from "vitest";
import { GET } from "@/app/docs/route";

describe("GET /docs", () => {
  it("serves an HTML page that mounts Scalar against the spec", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const body = await res.text();
    expect(body).toContain('data-url="/api/openapi.json"');
    expect(body).toContain("@scalar/api-reference");
  });
});
