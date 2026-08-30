import { it, expect } from "vitest";
import {
  isPocketSmithRow, descTokens, tokenOverlap,
  isCrossSourceDuplicate, planDedupActions, type DedupRow,
} from "@/lib/dedup/cross-source";

function row(p: Partial<DedupRow>): DedupRow {
  return {
    id: "id", akahu_transaction_id: "acc_x", household_id: "h1",
    account_id: "a1", occurred_at: "2026-04-29T00:00:00Z", amount: -275.67,
    description: "Canopy Camping Es 29 524651 2685", category_id: null,
    is_manual_category: false, ...p,
  };
}

it("isPocketSmithRow detects the ps_ prefix", () => {
  expect(isPocketSmithRow({ akahu_transaction_id: "ps_123" })).toBe(true);
  expect(isPocketSmithRow({ akahu_transaction_id: "acc_123" })).toBe(false);
});

it("descTokens strips digits/punctuation and short words", () => {
  expect([...descTokens("Canopy Camping Es 29 524651****** 2685")].sort())
    .toEqual(["camping", "canopy"]);
});

it("descTokens strips the bank-noise 'CARD' prefix token", () => {
  expect([...descTokens("CARD 8544 APPLE.COM/BILL SYDNEY")].sort())
    .toEqual(["apple", "bill", "com", "sydney"]);
});

it("tokenOverlap is Jaccard similarity", () => {
  expect(tokenOverlap(descTokens("canopy camping"), descTokens("canopy camping"))).toBe(1);
  expect(tokenOverlap(descTokens("canopy camping"), descTokens("scenic hotel"))).toBe(0);
});

it("high confidence: amount + near date + strong desc overlap, despite different accounts", () => {
  // Real cross-source dups always differ in account_id (PS synthetic vs Akahu real).
  const akahu = row({ id: "ak", akahu_transaction_id: "acc_1", account_id: "akahu-acct",
    occurred_at: "2026-05-01T11:59:59Z", description: "Canopy Camping Es 29 524651****** 2685" });
  const ps = row({ id: "ps", akahu_transaction_id: "ps_1", account_id: "ps-history",
    occurred_at: "2026-04-29T00:00:00Z", description: "Canopy Camping Es 29 524651 2685",
    category_id: "c-holidays", is_manual_category: true });
  const r = isCrossSourceDuplicate(akahu, [ps]);
  expect(r.confidence).toBe("high");
  expect(r.match?.id).toBe("ps");
});

it("picks the strongest-overlap candidate among same amount+date matches", () => {
  const akahu = row({ id: "ak", akahu_transaction_id: "acc_1", account_id: "akahu-acct",
    occurred_at: "2026-04-20T00:00:00Z", amount: -200, description: "1330Warner and The W Bills BILL" });
  const coincidental = row({ id: "ps-wrong", akahu_transaction_id: "ps_x", account_id: "ps-history",
    occurred_at: "2026-04-20T00:00:00Z", amount: -200, description: "BG Warner ASB ASB" });
  const realDup = row({ id: "ps-right", akahu_transaction_id: "ps_y", account_id: "ps-history",
    occurred_at: "2026-04-20T00:00:00Z", amount: -200, description: "1330Warner and The W Bills BILL" });
  const r = isCrossSourceDuplicate(akahu, [coincidental, realDup]);
  expect(r.confidence).toBe("high");
  expect(r.match?.id).toBe("ps-right");
});

it("no match when more than tolerance days apart", () => {
  const akahu = row({ id: "ak", akahu_transaction_id: "acc_1", occurred_at: "2026-05-10T00:00:00Z" });
  const ps = row({ id: "ps", akahu_transaction_id: "ps_1", occurred_at: "2026-04-29T00:00:00Z" });
  expect(isCrossSourceDuplicate(akahu, [ps]).match).toBeNull();
});

it("no match when amounts differ", () => {
  const akahu = row({ id: "ak", akahu_transaction_id: "acc_1", amount: -275.67 });
  const ps = row({ id: "ps", akahu_transaction_id: "ps_1", amount: -200.00 });
  expect(isCrossSourceDuplicate(akahu, [ps]).match).toBeNull();
});

it("fuzzy: amount+date match but different account / weak desc", () => {
  const akahu = row({ id: "ak", akahu_transaction_id: "acc_1", account_id: "a1", description: "Foo Bar" });
  const ps = row({ id: "ps", akahu_transaction_id: "ps_1", account_id: "a2", description: "Totally Different" });
  expect(isCrossSourceDuplicate(akahu, [ps]).confidence).toBe("fuzzy");
});

it("planDedupActions: high -> resolve with ported category when akahu non-manual", () => {
  const akahu = row({ id: "ak", akahu_transaction_id: "acc_1", occurred_at: "2026-05-01T00:00:00Z",
    description: "Canopy Camping", is_manual_category: false });
  const ps = row({ id: "ps", akahu_transaction_id: "ps_1", occurred_at: "2026-04-29T00:00:00Z",
    description: "Canopy Camping", category_id: "c-holidays", is_manual_category: true });
  expect(planDedupActions([akahu], [ps])).toEqual([
    { kind: "resolve", akahuId: "ak", psId: "ps", portCategoryId: "c-holidays" },
  ]);
});

it("planDedupActions: high but akahu already manual -> do not port", () => {
  const akahu = row({ id: "ak", akahu_transaction_id: "acc_1", occurred_at: "2026-05-01T00:00:00Z",
    description: "Canopy Camping", is_manual_category: true });
  const ps = row({ id: "ps", akahu_transaction_id: "ps_1", occurred_at: "2026-04-29T00:00:00Z",
    description: "Canopy Camping", category_id: "c-holidays" });
  expect(planDedupActions([akahu], [ps])).toEqual([
    { kind: "resolve", akahuId: "ak", psId: "ps", portCategoryId: null },
  ]);
});

it("planDedupActions: fuzzy -> flag", () => {
  const akahu = row({ id: "ak", akahu_transaction_id: "acc_1", account_id: "a1", description: "Foo" });
  const ps = row({ id: "ps", akahu_transaction_id: "ps_1", account_id: "a2", description: "Bar" });
  expect(planDedupActions([akahu], [ps])).toEqual([{ kind: "flag", akahuId: "ak" }]);
});

it("planDedupActions: fuzzy but akahu already categorised -> no flag (don't re-surface a filed row)", () => {
  // A coincidental same-amount PS row (shares only a surname token) must not keep
  // re-flagging an already-categorised Akahu transfer for review on every poll.
  const akahu = row({ id: "ak", akahu_transaction_id: "acc_1", account_id: "a1",
    description: "Warner B G SavingsRC", category_id: "c-transfers" });
  const ps = row({ id: "ps", akahu_transaction_id: "ps_1", account_id: "a2",
    description: "G A & M D Warner Coffee Beans" });
  expect(planDedupActions([akahu], [ps])).toEqual([]);
});
