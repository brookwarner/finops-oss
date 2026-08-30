import { describe, it, expect } from "vitest";
import { isManualId, slugify, mintId, validateAsset, ALLOWED_TYPES } from "./manual";

describe("isManualId", () => {
  it("accepts manual_ ids and rejects akahu/other ids", () => {
    expect(isManualId("manual_home_example")).toBe(true);
    expect(isManualId("acc_example_revolving")).toBe(false);
    expect(isManualId("ps_history_synthetic")).toBe(false);
    expect(isManualId("")).toBe(false);
  });
});

describe("slugify", () => {
  it("produces a manual_ kebab id, stripping punctuation", () => {
    expect(slugify("Private Equity — Acme")).toBe("manual_private_equity_acme");
    expect(slugify("Boat @ 12 Example St!!")).toBe("manual_boat_12_example_st");
  });
});

describe("mintId", () => {
  it("suffixes on collision", () => {
    const existing = new Set(["manual_caravan"]);
    expect(mintId("Caravan", existing)).toBe("manual_caravan_2");
    expect(mintId("Boat", existing)).toBe("manual_boat");
  });
});

describe("validateAsset", () => {
  it("accepts a valid asset and defaults type/currency", () => {
    const r = validateAsset({ name: "Acme", balance: 1000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("other");
      expect(r.value.currency).toBe("NZD");
      expect(r.value.balance).toBe(1000);
    }
  });
  it("defaults currency to NZD when DEFAULT_CURRENCY is unset", () => {
    const r = validateAsset({ name: "x", balance: 1 });
    expect(r.ok && r.value.currency).toBe("NZD");
  });
  it("rejects empty name, non-finite balance, bad type", () => {
    expect(validateAsset({ name: "  ", balance: 1 }).ok).toBe(false);
    expect(validateAsset({ name: "x", balance: NaN }).ok).toBe(false);
    expect(validateAsset({ name: "x", balance: "5" as unknown as number }).ok).toBe(false);
    expect(validateAsset({ name: "x", balance: 1, type: "bogus" }).ok).toBe(false);
  });
  it("accepts a negative balance (liability)", () => {
    expect(validateAsset({ name: "Loan to mate", balance: -500 }).ok).toBe(true);
  });
  it("ALLOWED_TYPES includes other/investment/savings/receivable", () => {
    expect(ALLOWED_TYPES.has("other")).toBe(true);
    expect(ALLOWED_TYPES.has("investment")).toBe(true);
    expect(ALLOWED_TYPES.has("savings")).toBe(true);
    expect(ALLOWED_TYPES.has("receivable")).toBe(true);
  });
  it("accepts a receivable asset", () => {
    const r = validateAsset({ name: "Tax refund", balance: 1200, type: "receivable" });
    expect(r.ok).toBe(true);
  });
});
