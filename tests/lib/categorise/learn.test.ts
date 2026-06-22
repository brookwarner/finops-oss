import { it, expect } from "vitest";
import { deriveLearnedRule } from "@/lib/categorise/learn";

it("prefers an exact merchant rule when a merchant is present", () => {
  expect(deriveLearnedRule("PAKNSAVE", "card 1234 paknsave")).toEqual({
    match_type: "exact",
    match_value: "PAKNSAVE",
    field: "merchant",
  });
});

it("falls back to a description-stem pattern when merchant is null (the nightly-transfer case)", () => {
  // Bank transfers carry no merchant; the nightly LLM must still learn from the
  // description so a recurring named transfer stops getting re-asked.
  expect(deriveLearnedRule(null, "Warner B G SavingsRC")).toEqual({
    match_type: "pattern",
    match_value: "Warner B G SavingsRC",
    field: "description",
  });
});

it("refuses to learn from a generic transfer-mechanism description", () => {
  // A rule on "internet transfer" would mis-file unrelated future transfers, so
  // deriveLearnedRule returns null and the nightly path simply skips caching.
  expect(deriveLearnedRule(null, "Choices WBC Internet Transfer wbc internet")).toBeNull();
});

it("returns null when there is neither merchant nor a usable description", () => {
  expect(deriveLearnedRule(null, null)).toBeNull();
  expect(deriveLearnedRule("", "to 123")).toBeNull();
});
