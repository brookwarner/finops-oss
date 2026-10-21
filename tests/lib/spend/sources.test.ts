import { describe, it, expect } from "vitest";
import { SPENDABLE_KINDS, listSpendGroups, normaliseGroup } from "@/lib/spend/sources";

describe("SPENDABLE_KINDS", () => {
  // Reserves are lumpy spend, not a separate concept — the forecast already reads
  // spend_class off reserve budgets, so the editor must be able to set it.
  it("includes reserve alongside monthly_cap and ap_amortised", () => {
    expect([...SPENDABLE_KINDS].sort()).toEqual(["ap_amortised", "monthly_cap", "reserve"]);
  });

  it("excludes non-spend kinds", () => {
    for (const k of ["income", "savings", "transfer", "system", "business_subsidy"]) {
      expect(SPENDABLE_KINDS).not.toContain(k);
    }
  });
});

describe("listSpendGroups", () => {
  it("returns used groups in canonical display order", () => {
    expect(
      listSpendGroups([{ group: "Mortgage" }, { group: "Food" }, { group: "Discretionary" }]),
    ).toEqual(["Food", "Discretionary", "Mortgage"]);
  });

  it("drops nulls and dedupes", () => {
    expect(listSpendGroups([{ group: null }, { group: "Food" }, { group: "Food" }])).toEqual([
      "Food",
    ]);
  });

  it("keeps a household's own group names, after the canonical ones", () => {
    expect(listSpendGroups([{ group: "Firewood shed" }, { group: "Food" }])).toEqual([
      "Food",
      "Firewood shed",
    ]);
  });

  it("returns nothing when no category is grouped", () => {
    expect(listSpendGroups([{ group: null }, { group: null }])).toEqual([]);
  });
});

describe("normaliseGroup", () => {
  it("trims and collapses inner whitespace", () => {
    expect(normaliseGroup("  Home   Maintenance ")).toBe("Home Maintenance");
  });

  it("treats blank input as no group", () => {
    expect(normaliseGroup("")).toBeNull();
    expect(normaliseGroup("   ")).toBeNull();
    expect(normaliseGroup(null)).toBeNull();
    expect(normaliseGroup(undefined)).toBeNull();
  });

  it("leaves an already-clean name alone", () => {
    expect(normaliseGroup("Maintenance")).toBe("Maintenance");
  });
});
