// src/lib/categorise/learn.test.ts
import { describe, it, expect } from "vitest";
import { deriveLearnedRule } from "@/lib/categorise/learn";

describe("deriveLearnedRule — merchant present", () => {
  it("prefers an exact merchant rule", () => {
    expect(deriveLearnedRule("Z Energy", "Z Energy 12 2685")).toEqual({
      match_type: "exact",
      match_value: "Z Energy",
      field: "merchant",
    });
  });

  it("trims the merchant", () => {
    expect(deriveLearnedRule("  Countdown  ", null)?.match_value).toBe("Countdown");
  });
});

describe("deriveLearnedRule — empty merchant, derive from description", () => {
  it("extracts a clean merchant stem before the card/ref digits", () => {
    expect(deriveLearnedRule(null, "Chemist Warehouse 05 524651 2685 524651")).toEqual({
      match_type: "pattern",
      match_value: "Chemist Warehouse",
      field: "description",
    });
  });

  it("strips a leading account-code prefix", () => {
    // "9340Jocelyn..." would otherwise stem to a numeric-prefixed token
    expect(deriveLearnedRule(null, "Stark Raving Dad 12 524651 2685 USD 10.00")?.match_value).toBe(
      "Stark Raving Dad",
    );
  });

  it("keeps a single-token-station style merchant", () => {
    expect(deriveLearnedRule(null, "Z Matamata 29 524651 2685")?.match_value).toBe("Z Matamata");
  });
});

describe("deriveLearnedRule — rejects noise (returns null)", () => {
  it("rejects bank-mechanism descriptions", () => {
    expect(deriveLearnedRule(null, "9340Jocelyn Schache WBC Internet Bill Payment")).toBeNull();
    expect(deriveLearnedRule(null, "Karen Cullen WBC Internet One Time PMT")).toBeNull();
    expect(deriveLearnedRule(null, "TO 12-3147- 0565405-00 MB TRANSFER")).toBeNull();
    expect(deriveLearnedRule(null, "Payment to: 70013400345 loan/equity")).toBeNull();
  });

  it("rejects person-to-person 'from X' transfers", () => {
    expect(deriveLearnedRule(null, "from partnerfor dinner fc12-3031-0377373-01")).toBeNull();
    expect(deriveLearnedRule(null, "from g a & m d warner photo shoot")).toBeNull();
  });

  it("rejects stems that are too short or have no real word", () => {
    expect(deriveLearnedRule(null, "EX 12-3100")).toBeNull();
    expect(deriveLearnedRule(null, "00033230 Balance")).toBeNull();
    expect(deriveLearnedRule(null, null)).toBeNull();
    expect(deriveLearnedRule(null, "")).toBeNull();
  });
});
