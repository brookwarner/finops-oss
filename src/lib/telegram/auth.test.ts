import { describe, it, expect } from "vitest";
import { checkWebhookAuth } from "@/lib/telegram/auth";

const cfg = { secret: "s3cret", allowedSenderId: "12345" };

describe("checkWebhookAuth", () => {
  it("rejects a missing/wrong secret header", () => {
    expect(checkWebhookAuth({ secretHeader: undefined, fromId: "12345" }, cfg)).toEqual({ ok: false, status: 401 });
    expect(checkWebhookAuth({ secretHeader: "nope", fromId: "12345" }, cfg)).toEqual({ ok: false, status: 401 });
  });
  it("ignores a wrong sender with 200 (no leak)", () => {
    expect(checkWebhookAuth({ secretHeader: "s3cret", fromId: "999" }, cfg)).toEqual({ ok: false, status: 200 });
  });
  it("passes a valid secret + allowed sender", () => {
    expect(checkWebhookAuth({ secretHeader: "s3cret", fromId: "12345" }, cfg)).toEqual({ ok: true });
  });
  it("fails closed when not configured", () => {
    expect(checkWebhookAuth({ secretHeader: "x", fromId: "1" }, { secret: undefined, allowedSenderId: "1" })).toEqual({ ok: false, status: 401 });
  });
});
