import { describe, it, expect } from "vitest";
import { allocateContributions, sumContributions } from "./buffer";

describe("sumContributions", () => {
  it("sums only inflows (positive amounts), ignoring outflows/drawdowns", () => {
    expect(sumContributions([{ amount: 340 }, { amount: 200 }, { amount: -150 }])).toBe(540);
  });
  it("returns 0 for no inflows", () => {
    expect(sumContributions([{ amount: -10 }])).toBe(0);
  });
});

describe("allocateContributions", () => {
  it("credits a single behind reserve, capped at its shortfall", () => {
    const { credited, uncommitted } = allocateContributions(
      [{ categoryId: "home", shortfall: 1736 }],
      340,
    );
    expect(credited.get("home")).toBe(340);
    expect(uncommitted).toBe(0);
  });
  it("fills largest shortfall first across multiple reserves", () => {
    const { credited, uncommitted } = allocateContributions(
      [{ categoryId: "vet", shortfall: 100 }, { categoryId: "home", shortfall: 1736 }],
      1800,
    );
    expect(credited.get("home")).toBe(1736); // largest first, filled to zero
    expect(credited.get("vet")).toBe(64);    // remainder
    expect(uncommitted).toBe(0);
  });
  it("returns leftover as uncommitted when the pot exceeds total shortfall", () => {
    const { credited, uncommitted } = allocateContributions(
      [{ categoryId: "home", shortfall: 200 }],
      500,
    );
    expect(credited.get("home")).toBe(200);
    expect(uncommitted).toBe(300);
  });
  it("ignores reserves that are not behind and a zero pot", () => {
    const { credited, uncommitted } = allocateContributions(
      [{ categoryId: "home", shortfall: 0 }],
      0,
    );
    expect(credited.size).toBe(0);
    expect(uncommitted).toBe(0);
  });
  it("breaks shortfall ties deterministically by categoryId", () => {
    // Equal shortfalls, input out of categoryId order; only enough pot for the
    // first-ordered reserve. "alpha" < "beta", so alpha must be funded first.
    const { credited } = allocateContributions(
      [{ categoryId: "beta", shortfall: 100 }, { categoryId: "alpha", shortfall: 100 }],
      100,
    );
    expect(credited.get("alpha")).toBe(100);
    expect(credited.has("beta")).toBe(false);
  });
});
