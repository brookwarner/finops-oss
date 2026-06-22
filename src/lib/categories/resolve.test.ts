import { describe, it, expect } from "vitest";
import { pickCategory, type Cat } from "./resolve";

const cats: Cat[] = [
  { id: "c1", name: "Groceries", group: "Food" },
  { id: "c2", name: "Dining Out", group: "Food" },
  { id: "c3", name: "Pets", group: "Home" },
];

describe("pickCategory", () => {
  it("matches exact name case-insensitively", () => {
    expect(pickCategory(cats, "groceries")).toEqual({ ok: true, category: cats[0] });
  });

  it("matches a unique substring", () => {
    expect(pickCategory(cats, "din")).toEqual({ ok: true, category: cats[1] });
  });

  it("prefers an exact match over a substring of another", () => {
    const withClash: Cat[] = [...cats, { id: "c4", name: "Pet", group: "Home" }];
    expect(pickCategory(withClash, "Pet")).toEqual({ ok: true, category: withClash[3] });
  });

  it("refuses on ambiguous substring with the matching candidates", () => {
    const r = pickCategory(cats, "o");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("ambiguous");
      expect(r.candidates.length).toBeGreaterThan(1);
    }
  });

  it("refuses on no match, returning all candidates", () => {
    const r = pickCategory(cats, "zzz");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("none");
      expect(r.candidates).toHaveLength(3);
    }
  });
});
