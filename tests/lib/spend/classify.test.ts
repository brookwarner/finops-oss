import { describe, it, expect } from "vitest";
import { normaliseSpendClass, isEssential, defaultSpendClass } from "@/lib/spend/classify";

describe("normaliseSpendClass", () => {
  it("NULL/unknown ⇒ essential (conservative)", () => {
    expect(normaliseSpendClass(null)).toBe("essential");
    expect(normaliseSpendClass(undefined)).toBe("essential");
    expect(normaliseSpendClass("garbage")).toBe("essential");
  });
  it("passes through valid values", () => {
    expect(normaliseSpendClass("discretionary")).toBe("discretionary");
    expect(normaliseSpendClass("essential")).toBe("essential");
  });
});

describe("isEssential", () => {
  it("true for null and essential, false for discretionary", () => {
    expect(isEssential(null)).toBe(true);
    expect(isEssential("essential")).toBe(true);
    expect(isEssential("discretionary")).toBe(false);
  });
});

describe("defaultSpendClass", () => {
  it("classifies by name first", () => {
    expect(defaultSpendClass("Food", "Groceries")).toBe("essential");
    expect(defaultSpendClass("Food", "Restaurants/Dining/Snacks")).toBe("discretionary");
  });
  it("falls back to group", () => {
    expect(defaultSpendClass("Discretionary", "Anything New")).toBe("discretionary");
    expect(defaultSpendClass("Maintenance", "New Repair")).toBe("discretionary");
  });
  it("defaults unknown to essential", () => {
    expect(defaultSpendClass("Mystery", "Unknown Thing")).toBe("essential");
  });
});
