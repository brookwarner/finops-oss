import { describe, it, expect } from "vitest";
import { subsLines } from "./format.mjs";

describe("subsLines", () => {
  it("renders one line per active sub plus a total", () => {
    const out = subsLines({
      subscriptions: [
        { displayName: "Spotify", cadence: "monthly", monthly: 33.99, nextExpected: "2026-06-22", status: "active", priceChanged: false },
        { displayName: "Insurance", cadence: "annual", monthly: 50, nextExpected: "2026-12-01", status: "active", priceChanged: true },
      ],
      totals: { monthly: 83.99, annual: 1007.88, count: 2 },
    });
    const text = out.join("\n");
    expect(text).toMatch(/Spotify/);
    expect(text).toMatch(/Insurance/);
    expect(text).toMatch(/83\.99/);
    expect(text).toMatch(/↑/);
  });

  it("notes when there are no subscriptions", () => {
    const out = subsLines({ subscriptions: [], totals: { monthly: 0, annual: 0, count: 0 } });
    expect(out.join("\n")).toMatch(/No subscriptions/i);
  });
});
