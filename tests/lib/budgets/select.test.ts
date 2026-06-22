import { describe, it, expect } from "vitest";
import { filterByGroup, findCategory } from "@/lib/budgets/select";

const rows = [
  { category: "Groceries", group: "Food" },
  { category: "Restaurants", group: "Food" },
  { category: "Power", group: "Utilities" },
  { category: "Pet Food", group: null },
];

describe("filterByGroup", () => {
  it("returns all rows when group is falsy", () => {
    expect(filterByGroup(rows, undefined)).toBe(rows);
    expect(filterByGroup(rows, null)).toBe(rows);
    expect(filterByGroup(rows, "")).toBe(rows);
  });

  it("filters case-insensitively by group", () => {
    expect(filterByGroup(rows, "food").map((r) => r.category)).toEqual([
      "Groceries",
      "Restaurants",
    ]);
    expect(filterByGroup(rows, "UTILITIES").map((r) => r.category)).toEqual(["Power"]);
  });

  it("ignores rows with a null group when filtering", () => {
    expect(filterByGroup(rows, "nonexistent")).toEqual([]);
  });
});

describe("findCategory", () => {
  it("prefers an exact case-insensitive match", () => {
    expect(findCategory(rows, "groceries")?.category).toBe("Groceries");
    expect(findCategory(rows, "POWER")?.category).toBe("Power");
  });

  it("falls back to the first substring match", () => {
    // "food" is not an exact category but matches "Pet Food" as a substring.
    expect(findCategory(rows, "food")?.category).toBe("Pet Food");
  });

  it("prefers exact over substring when both could match", () => {
    const r = [{ category: "Pet" }, { category: "Pet Food" }];
    expect(findCategory(r, "pet")?.category).toBe("Pet");
  });

  it("returns undefined when nothing matches", () => {
    expect(findCategory(rows, "zzz")).toBeUndefined();
  });
});
