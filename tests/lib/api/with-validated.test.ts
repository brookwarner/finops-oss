import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseRequest } from "@/lib/api/auth";

const schema = { query: z.object({ group: z.string().optional() }), body: z.object({ n: z.number() }) };

describe("parseRequest", () => {
  it("rejects an invalid body with a 400 issues payload", async () => {
    const req = new Request("https://x/api/t?group=food", {
      method: "POST",
      body: JSON.stringify({ n: "nope" }),
      headers: { "content-type": "application/json" },
    });
    const r = await parseRequest(req, schema);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(400);
      const j = await r.response.json();
      expect(j.error).toBeTruthy();
      expect(j.issues).toBeTruthy();
    }
  });

  it("passes typed query + body through on success", async () => {
    const req = new Request("https://x/api/t?group=food", {
      method: "POST",
      body: JSON.stringify({ n: 5 }),
      headers: { "content-type": "application/json" },
    });
    const r = await parseRequest(req, schema);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.query.group).toBe("food");
      expect(r.data.body.n).toBe(5);
    }
  });
});
