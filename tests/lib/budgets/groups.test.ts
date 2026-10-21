import { describe, it, expect } from "vitest";
import { GROUP_ORDER, orderGroups } from "@/lib/budgets/groups";

describe("orderGroups", () => {
  it("returns known groups in GROUP_ORDER, not input order", () => {
    expect(orderGroups(["Mortgage", "Food", "Discretionary"])).toEqual([
      "Food",
      "Discretionary",
      "Mortgage",
    ]);
  });

  it("puts unknown groups after known ones, alphabetically", () => {
    expect(orderGroups(["Zoo", "Food", "Aviary", "Mortgage"])).toEqual([
      "Food",
      "Mortgage",
      "Aviary",
      "Zoo",
    ]);
  });

  it("dedupes", () => {
    expect(orderGroups(["Food", "Food", "Zoo", "Zoo"])).toEqual(["Food", "Zoo"]);
  });

  it("omits known groups that aren't present", () => {
    expect(orderGroups(["Food"])).toEqual(["Food"]);
  });

  it("handles an empty input", () => {
    expect(orderGroups([])).toEqual([]);
  });

  it("does not mutate GROUP_ORDER", () => {
    const before = [...GROUP_ORDER];
    orderGroups(["Zoo", "Food"]);
    expect(GROUP_ORDER).toEqual(before);
  });
});
