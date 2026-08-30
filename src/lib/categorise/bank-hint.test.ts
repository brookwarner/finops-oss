// src/lib/categorise/bank-hint.test.ts
import { describe, it, expect } from "vitest";
import { resolveBankHint, BANK_HINT_BY_NAME } from "@/lib/categorise/bank-hint";

describe("resolveBankHint", () => {
  const categories = [
    { id: "cat-groceries", name: "Groceries" },
    { id: "cat-fuel", name: "Gasoline/Fuel" },
    { id: "cat-dining", name: "Restaurants/Dining/Snacks" },
  ];

  it("maps Akahu category name to our category id", () => {
    const map = resolveBankHint(categories);
    expect(map["Supermarkets and grocery stores"]).toBe("cat-groceries");
    expect(map["Fuel stations"]).toBe("cat-fuel");
    expect(map["Cafes and restaurants"]).toBe("cat-dining");
  });

  it("drops mappings whose target category is absent", () => {
    const map = resolveBankHint([{ id: "cat-groceries", name: "Groceries" }]);
    expect(map["Fuel stations"]).toBeUndefined();
    expect(map["Supermarkets and grocery stores"]).toBe("cat-groceries");
  });

  it("every mapped target name is a plausible non-empty string", () => {
    for (const ourName of Object.values(BANK_HINT_BY_NAME)) {
      expect(ourName.length).toBeGreaterThan(0);
    }
  });
});
