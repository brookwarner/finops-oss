import { describe, it, expect } from "vitest";
import { normaliseInviteEmail, computePendingInvites } from "@/lib/household/members";

describe("normaliseInviteEmail", () => {
  it("trims and lowercases", () => {
    expect(normaliseInviteEmail("  Partner@Example.COM ")).toBe("partner@example.com");
  });
  it("throws on empty", () => {
    expect(() => normaliseInviteEmail("   ")).toThrow();
  });
  it("throws on invalid", () => {
    expect(() => normaliseInviteEmail("not-an-email")).toThrow();
  });
});

describe("computePendingInvites", () => {
  it("returns allowlist emails that aren't members", () => {
    expect(computePendingInvites(["a@x.com", "b@x.com"], ["a@x.com"])).toEqual(["b@x.com"]);
  });
  it("is case-insensitive", () => {
    expect(computePendingInvites(["Partner@X.com"], ["partner@x.com"])).toEqual([]);
  });
  it("ignores null member emails", () => {
    expect(computePendingInvites(["a@x.com"], [null])).toEqual(["a@x.com"]);
  });
});
