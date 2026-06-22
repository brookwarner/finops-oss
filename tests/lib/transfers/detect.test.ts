import { it, expect } from "vitest";
import {
  hasTransferKeyword, corroborated, matchTransferPairs,
  planTransferActions, type TransferTxn,
} from "@/lib/transfers/detect";

function tx(p: Partial<TransferTxn>): TransferTxn {
  return {
    id: "id", household_id: "h1", account_id: "a1",
    occurred_at: "2026-05-20T00:00:00Z", amount: -100,
    description: "x", category_id: null, category_kind: null, ...p,
  };
}

it("hasTransferKeyword spots transfer mechanism text", () => {
  expect(hasTransferKeyword("TO 0187-0095918-00 WBC INTER")).toBe(true);
  expect(hasTransferKeyword("MB TRANSFER TO CARD 8544")).toBe(true);
  expect(hasTransferKeyword("Loan repayment 0187 0095918")).toBe(true);
  expect(hasTransferKeyword("PAK N SAVE GLENFIELD")).toBe(false);
});

it("corroborated: shared account-ref digit run", () => {
  expect(corroborated("TO 0187-0095918-00 WBC INTER", "FROM 0187-0095918-01 WBC INT")).toBe(true);
});

it("corroborated: false for unrelated descriptions", () => {
  expect(corroborated("PAK N SAVE", "MITRE 10 MEGA")).toBe(false);
});

it("opposite-leg corroborated pair -> high", () => {
  const a = tx({ id: "a", account_id: "chq", amount: -2000, description: "TO 0187-0095918-00 WBC INTER" });
  const b = tx({ id: "b", account_id: "sav", amount: 2000, description: "FROM 0187-0095918-01 WBC INT" });
  const pairs = matchTransferPairs([a, b]);
  expect(pairs).toHaveLength(1);
  expect(pairs[0].confidence).toBe("high");
  expect(new Set(pairs[0].legs.map((l) => l.id))).toEqual(new Set(["a", "b"]));
});

it("opposite-leg WITHOUT corroboration -> fuzzy (coincidental income/expense)", () => {
  const a = tx({ id: "a", account_id: "chq", amount: -200, description: "PAK N SAVE" });
  const b = tx({ id: "b", account_id: "sav", amount: 200, description: "SALARY ACME LTD" });
  const pairs = matchTransferPairs([a, b]);
  expect(pairs[0].confidence).toBe("fuzzy");
});

it("same-sign cross-account pair is NOT a transfer (dup/coincidence, excluded)", () => {
  const a = tx({ id: "a", account_id: "chq", amount: -576.78, description: "SO-027669 B Warner" });
  const b = tx({ id: "b", account_id: "loan", amount: -576.78, description: "SO-027669 B Warner" });
  expect(matchTransferPairs([a, b])).toHaveLength(0);
});

it("no pair for same account", () => {
  const a = tx({ id: "a", account_id: "chq", amount: -50, description: "COFFEE" });
  const b = tx({ id: "b", account_id: "chq", amount: 50, description: "COFFEE REFUND" });
  expect(matchTransferPairs([a, b])).toHaveLength(0);
});

it("no pair when dates too far apart", () => {
  const a = tx({ id: "a", account_id: "chq", amount: -2000, occurred_at: "2026-05-01T00:00:00Z", description: "TO 0187-0095918 WBC" });
  const b = tx({ id: "b", account_id: "sav", amount: 2000, occurred_at: "2026-05-10T00:00:00Z", description: "FROM 0187-0095918 WBC" });
  expect(matchTransferPairs([a, b])).toHaveLength(0);
});

it("planTransferActions: ingest mode auto-assigns high pairs, only when uncategorised", () => {
  const a = tx({ id: "a", account_id: "chq", amount: -2000, description: "TO 0187-0095918-00 WBC INTER" });
  const b = tx({ id: "b", account_id: "sav", amount: 2000, description: "FROM 0187-0095918-01 WBC INT" });
  const actions = planTransferActions([a, b], { mode: "ingest", transfersCategoryId: "T" });
  expect(actions).toEqual([
    { kind: "assign", txnId: "a", categoryId: "T" },
    { kind: "assign", txnId: "b", categoryId: "T" },
  ]);
});

it("planTransferActions: ingest mode skips already-categorised legs (mortgage protection)", () => {
  const a = tx({ id: "a", account_id: "chq", amount: -1208, category_id: "mort", category_kind: "ap_amortised", description: "Loan repayment 0187 0095918" });
  const b = tx({ id: "b", account_id: "loan", amount: 1208, category_id: "mort", category_kind: "ap_amortised", description: "Loan repayment" });
  expect(planTransferActions([a, b], { mode: "ingest", transfersCategoryId: "T" })).toEqual([]);
});

it("planTransferActions: sweep mode flags spend-categorised suspects, skips ap_amortised + income", () => {
  const spend = tx({ id: "s", account_id: "chq", amount: -200, category_id: "groc", category_kind: "monthly_cap", description: "TO 0187-0095918 WBC" });
  const spend2 = tx({ id: "s2", account_id: "sav", amount: 200, category_id: "inc", category_kind: "income", description: "FROM 0187-0095918 WBC" });
  const actions = planTransferActions([spend, spend2], { mode: "sweep", transfersCategoryId: "T" });
  expect(actions).toEqual([{ kind: "flag", txnId: "s" }]);
});
