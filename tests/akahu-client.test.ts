import { describe, it, expect } from "vitest";
import { buildAkahuClient } from "@/lib/akahu/client";

describe("buildAkahuClient", () => {
  it("throws if app token is missing", () => {
    expect(() => buildAkahuClient({ appToken: "", appSecret: "x" })).toThrow(
      "AKAHU_APP_TOKEN is required",
    );
  });

  it("throws if app secret is missing", () => {
    expect(() => buildAkahuClient({ appToken: "x", appSecret: "" })).toThrow(
      "AKAHU_APP_SECRET is required",
    );
  });

  it("returns a configured client when both are provided", () => {
    const client = buildAkahuClient({ appToken: "app_token_x", appSecret: "secret" });
    expect(client).toBeDefined();
    expect(typeof client.accounts.list).toBe("function");
  });
});
