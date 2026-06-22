import { describe, it, expect } from "vitest";
import { setBudgetTargetSchema, UUID_RE } from "@/lib/api/validation";

describe("setBudgetTargetSchema", () => {
  it("accepts a valid payload", () => {
    const r = setBudgetTargetSchema.safeParse({ category: "Groceries", monthlyTarget: 500 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ category: "Groceries", monthlyTarget: 500 });
  });

  it("accepts a zero target", () => {
    expect(setBudgetTargetSchema.safeParse({ category: "x", monthlyTarget: 0 }).success).toBe(true);
  });

  it("rejects an empty category", () => {
    expect(setBudgetTargetSchema.safeParse({ category: "", monthlyTarget: 10 }).success).toBe(false);
  });

  it("rejects a negative target", () => {
    expect(setBudgetTargetSchema.safeParse({ category: "x", monthlyTarget: -1 }).success).toBe(false);
  });

  it("rejects a non-finite target", () => {
    expect(setBudgetTargetSchema.safeParse({ category: "x", monthlyTarget: Infinity }).success).toBe(false);
    expect(setBudgetTargetSchema.safeParse({ category: "x", monthlyTarget: NaN }).success).toBe(false);
  });

  it("rejects a missing target", () => {
    expect(setBudgetTargetSchema.safeParse({ category: "x" }).success).toBe(false);
  });
});

describe("UUID_RE", () => {
  it("matches a canonical UUID, case-insensitively", () => {
    expect(UUID_RE.test("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(UUID_RE.test("123E4567-E89B-12D3-A456-426614174000")).toBe(true);
  });

  it("rejects non-UUIDs", () => {
    expect(UUID_RE.test("not-a-uuid")).toBe(false);
    expect(UUID_RE.test("123e4567e89b12d3a456426614174000")).toBe(false);
  });
});
