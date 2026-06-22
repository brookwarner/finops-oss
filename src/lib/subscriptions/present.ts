import { priceTolerance, type Cadence } from "./detect";

export interface SubRow {
  display_name: string;
  cadence: Cadence;
  amount: number;
  amount_min: number;
  amount_max: number;
  next_expected: string;
  last_seen: string;
  status: "active" | "lapsed";
  category_id: string | null;
}

export interface PresentedSub {
  displayName: string;
  cadence: Cadence;
  amount: number;
  monthly: number;
  annual: number;
  nextExpected: string;
  lastSeen: string;
  status: "active" | "lapsed";
  categoryId: string | null;
  amountMin: number;
  amountMax: number;
  priceChanged: boolean;
}

export interface PresentResult {
  subscriptions: PresentedSub[];
  totals: { monthly: number; annual: number; count: number };
}

const MONTHS_PER: Record<Cadence, number> = {
  weekly: 52 / 12,
  fortnightly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
};

export function monthlyEquivalent(amount: number, cadence: Cadence): number {
  return amount * MONTHS_PER[cadence];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function presentSubscriptions(rows: SubRow[]): PresentResult {
  const presented: PresentedSub[] = rows.map((r) => {
    const monthly = round2(monthlyEquivalent(r.amount, r.cadence));
    return {
      displayName: r.display_name,
      cadence: r.cadence,
      amount: r.amount,
      monthly,
      annual: round2(monthly * 12),
      nextExpected: r.next_expected,
      lastSeen: r.last_seen,
      status: r.status,
      categoryId: r.category_id,
      amountMin: r.amount_min,
      amountMax: r.amount_max,
      priceChanged: r.amount_max - r.amount > priceTolerance(r.amount),
    };
  });

  presented.sort((a, b) => b.annual - a.annual);

  const active = presented.filter((s) => s.status === "active");
  const monthly = round2(active.reduce((sum, s) => sum + s.monthly, 0));
  return {
    subscriptions: presented,
    totals: { monthly, annual: round2(monthly * 12), count: active.length },
  };
}
