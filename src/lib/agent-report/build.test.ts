import { describe, it, expect } from "vitest";
import { parseAgentReport, buildMonthlyReviewRow } from "@/lib/agent-report/build";

describe("parseAgentReport", () => {
  it("accepts a valid report and defaults payload to {}", () => {
    const r = parseAgentReport({ title: "May review", body: "All good." });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.title).toBe("May review");
      expect(r.value.body).toBe("All good.");
      expect(r.value.payload).toEqual({});
    }
  });

  it("keeps a provided payload object", () => {
    const r = parseAgentReport({ title: "t", body: "b", payload: { overCaps: 2 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.payload).toEqual({ overCaps: 2 });
  });

  it("rejects empty title", () => {
    const r = parseAgentReport({ title: "", body: "b" });
    expect(r.ok).toBe(false);
  });

  it("rejects empty body", () => {
    const r = parseAgentReport({ title: "t", body: "" });
    expect(r.ok).toBe(false);
  });

  it("rejects body longer than 8000 chars", () => {
    const r = parseAgentReport({ title: "t", body: "x".repeat(8001) });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-object / null input", () => {
    expect(parseAgentReport(null).ok).toBe(false);
    expect(parseAgentReport("nope").ok).toBe(false);
  });
});

describe("buildMonthlyReviewRow", () => {
  const base = {
    householdId: "hh-1",
    periodStart: "2026-05-20",
    title: "May review",
    body: "All good.",
    payload: { overCaps: 1 },
  };

  it("maps to a monthly_review AlertRow with null marker fields", () => {
    const row = buildMonthlyReviewRow({ ...base, delivered: true, deliveryError: null });
    expect(row).toEqual({
      household_id: "hh-1",
      type: "monthly_review",
      category_id: null,
      period_start: "2026-05-20",
      state: null,
      txn_id: null,
      title: "May review",
      body: "All good.",
      payload: { overCaps: 1 },
      delivered: true,
      delivery_error: null,
    });
  });

  it("carries a delivery error when not delivered", () => {
    const row = buildMonthlyReviewRow({ ...base, delivered: false, deliveryError: "telegram not configured" });
    expect(row.delivered).toBe(false);
    expect(row.delivery_error).toBe("telegram not configured");
  });
});
