// src/lib/categorise/engine.test.ts
import { describe, it, expect } from "vitest";
import { categorise, categorisePending, type Rule, type TxnForCategorise } from "@/lib/categorise/engine";

const tx = (over: Partial<TxnForCategorise> = {}): TxnForCategorise => ({
  id: "t1",
  merchant: null,
  description: null,
  is_manual_category: false,
  akahu_category_name: null,
  ...over,
});

describe("categorise — rule layers", () => {
  it("returns null when nothing matches", () => {
    expect(categorise(tx({ merchant: "NOVEL" }), [])).toBeNull();
  });

  it("exact merchant rule wins, trusted (no review)", () => {
    const rules: Rule[] = [
      { id: "r1", category_id: "cat-a", match_type: "exact", match_value: "PAKNSAVE", field: "merchant", priority: 50 },
    ];
    expect(categorise(tx({ merchant: "PAKNSAVE" }), rules)).toEqual({
      category_id: "cat-a",
      needs_review: false,
    });
  });

  it("a cached LLM rule match stays flagged for review", () => {
    const rules: Rule[] = [
      { id: "r1", category_id: "cat-a", match_type: "exact", match_value: "NOVELCO", field: "merchant", priority: 70, source: "llm" },
    ];
    expect(categorise(tx({ merchant: "NOVELCO" }), rules)).toEqual({
      category_id: "cat-a",
      needs_review: true,
    });
  });
});

describe("categorisePending — merchant rules matched against the description prefix", () => {
  // Pending (unsettled) rows carry NO merchant — only a raw description whose
  // first token(s) are the merchant name. So a `merchant`-field rule is tested
  // as a case-insensitive PREFIX of the description (anchored, to avoid
  // mid-string false positives), while `description` rules keep substring/exact
  // semantics. Provisional only — used to attribute pending to budgets.
  const liquor: Rule[] = [
    { id: "r1", category_id: "cat-alcohol", match_type: "exact", match_value: "Liquorland", field: "merchant", priority: 50 },
  ];

  it("matches a merchant-exact rule as a description prefix (the real Liquorland case)", () => {
    // The exact `merchant: Liquorland` rule can't fire on a pending row (no
    // merchant), but the description starts with it — so it resolves here.
    expect(
      categorisePending({ description: "LIQUORLAND WESTCITY 524651****** 2685 05/06 13:46", amount: -56.97 }, liquor),
    ).toBe("cat-alcohol");
  });

  it("does NOT match when the merchant token appears mid-string (prefix-anchored)", () => {
    // "BP" must not match "SUPER BP DELI" — prefix anchoring prevents the
    // short-token false positives a bare substring would cause.
    const bp: Rule[] = [
      { id: "r1", category_id: "cat-fuel", match_type: "exact", match_value: "BP", field: "merchant", priority: 50 },
    ];
    expect(categorisePending({ description: "SUPER BP DELI 123", amount: -5 }, bp)).toBeNull();
    expect(categorisePending({ description: "BP CONNECT JUNCTION 524651", amount: -19.6 }, bp)).toBe("cat-fuel");
  });

  it("honours description-field pattern rules as case-insensitive substring", () => {
    const rules: Rule[] = [
      { id: "r1", category_id: "cat-alcohol", match_type: "pattern", match_value: "LIQUORLAND GLEN", field: "description", priority: 60 },
    ];
    expect(categorisePending({ description: "LIQUORLAND GLEN EDEN 05/06", amount: -40 }, rules)).toBe("cat-alcohol");
    // Different branch → the Glen-specific pattern correctly does not match.
    expect(categorisePending({ description: "LIQUORLAND WESTCITY 05/06", amount: -40 }, rules)).toBeNull();
  });

  it("respects priority order (lowest priority number wins)", () => {
    const rules: Rule[] = [
      { id: "r2", category_id: "cat-b", match_type: "exact", match_value: "BUNNINGS", field: "merchant", priority: 80 },
      { id: "r1", category_id: "cat-a", match_type: "exact", match_value: "BUNNINGS", field: "merchant", priority: 50 },
    ];
    expect(categorisePending({ description: "BUNNINGS - 9502 524651", amount: -62.33 }, rules)).toBe("cat-a");
  });

  it("respects the amount gate", () => {
    const rules: Rule[] = [
      { id: "r1", category_id: "cat-pie", match_type: "exact", match_value: "BP", field: "merchant", priority: 50, max_amount: 20 },
      { id: "r2", category_id: "cat-fuel", match_type: "exact", match_value: "BP", field: "merchant", priority: 60, min_amount: 20 },
    ];
    expect(categorisePending({ description: "BP CONNECT 5", amount: -4.6 }, rules)).toBe("cat-pie");
    expect(categorisePending({ description: "BP CONNECT 85", amount: -85 }, rules)).toBe("cat-fuel");
  });

  it("returns null when nothing matches (→ caller buckets as unallocated)", () => {
    expect(categorisePending({ description: "CREDIT AUTH 524651 06/06", amount: 60 }, liquor)).toBeNull();
  });
});

describe("categorise — bank-hint layer", () => {
  const bankHint = { "Supermarkets and grocery stores": "cat-groceries" };

  it("falls through to bank hint when no rule matches, trusted", () => {
    expect(
      categorise(tx({ merchant: "UNKNOWN", akahu_category_name: "Supermarkets and grocery stores" }), [], bankHint),
    ).toEqual({ category_id: "cat-groceries", needs_review: false });
  });

  it("rules take precedence over bank hint", () => {
    const rules: Rule[] = [
      { id: "r1", category_id: "cat-rule", match_type: "exact", match_value: "UNKNOWN", field: "merchant", priority: 50 },
    ];
    expect(
      categorise(tx({ merchant: "UNKNOWN", akahu_category_name: "Supermarkets and grocery stores" }), rules, bankHint),
    ).toEqual({ category_id: "cat-rule", needs_review: false });
  });

  it("ambiguous / unmapped Akahu category falls through to null", () => {
    expect(
      categorise(tx({ merchant: "UNKNOWN", akahu_category_name: "Convenience stores" }), [], bankHint),
    ).toBeNull();
  });

  it("no Akahu category → null", () => {
    expect(categorise(tx({ merchant: "UNKNOWN" }), [], bankHint)).toBeNull();
  });

  it("manual rows are skipped", () => {
    expect(
      categorise(tx({ is_manual_category: true, akahu_category_name: "Supermarkets and grocery stores" }), [], bankHint),
    ).toBeNull();
  });
});
