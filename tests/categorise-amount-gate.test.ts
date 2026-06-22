import { describe, it, expect } from "vitest";
import { categorise, type Rule, type TxnForCategorise } from "@/lib/categorise/engine";

const tx = (over: Partial<TxnForCategorise> = {}): TxnForCategorise => ({
  id: "t1",
  merchant: null,
  description: null,
  is_manual_category: false,
  ...over,
});

// Petrol stations resolve only by spend size: small = food, large = fuel.
// Two rules on the same pattern, split by an amount gate at $20.
const petrolRules: Rule[] = [
  { id: "food", category_id: "cat-food", match_type: "pattern", match_value: "BP", field: "description", priority: 45, max_amount: 20 },
  { id: "fuel", category_id: "cat-fuel", match_type: "pattern", match_value: "BP", field: "description", priority: 45, min_amount: 20 },
];

describe("categorise — amount gate", () => {
  it("small petrol spend → food (under the threshold)", () => {
    expect(categorise(tx({ description: "BP CONNECT", amount: -9 }), petrolRules)).toEqual({
      category_id: "cat-food",
      needs_review: false,
    });
  });

  it("large petrol spend → fuel (over the threshold)", () => {
    expect(categorise(tx({ description: "BP CONNECT", amount: -85 }), petrolRules)).toEqual({
      category_id: "cat-fuel",
      needs_review: false,
    });
  });

  it("threshold is half-open: exactly $20 lands in fuel, not food", () => {
    expect(categorise(tx({ description: "BP CONNECT", amount: -20 }), petrolRules)).toEqual({
      category_id: "cat-fuel",
      needs_review: false,
    });
  });

  it("just under $20 lands in food", () => {
    expect(categorise(tx({ description: "BP CONNECT", amount: -19.99 }), petrolRules)).toEqual({
      category_id: "cat-food",
      needs_review: false,
    });
  });

  it("magnitude is used, so a positive amount gates the same way", () => {
    expect(categorise(tx({ description: "BP CONNECT", amount: 9 }), petrolRules)).toEqual({
      category_id: "cat-food",
      needs_review: false,
    });
  });

  it("a bounded rule cannot apply when amount is missing", () => {
    expect(categorise(tx({ description: "BP CONNECT", amount: null }), petrolRules)).toBeNull();
    expect(categorise(tx({ description: "BP CONNECT" }), petrolRules)).toBeNull();
  });

  it("an unbounded rule still matches regardless of amount (back-compat)", () => {
    const rules: Rule[] = [
      { id: "r", category_id: "cat-any", match_type: "pattern", match_value: "BP", field: "description", priority: 50 },
    ];
    expect(categorise(tx({ description: "BP CONNECT", amount: -9 }), rules)).toEqual({
      category_id: "cat-any",
      needs_review: false,
    });
    expect(categorise(tx({ description: "BP CONNECT", amount: null }), rules)).toEqual({
      category_id: "cat-any",
      needs_review: false,
    });
  });

  it("a min-only gate is an inclusive lower bound", () => {
    const rules: Rule[] = [
      { id: "r", category_id: "cat-fuel", match_type: "pattern", match_value: "BP", field: "description", priority: 45, min_amount: 20 },
    ];
    expect(categorise(tx({ description: "BP CONNECT", amount: -20 }), rules)).toEqual({
      category_id: "cat-fuel",
      needs_review: false,
    });
    expect(categorise(tx({ description: "BP CONNECT", amount: -19 }), rules)).toBeNull();
  });
});
