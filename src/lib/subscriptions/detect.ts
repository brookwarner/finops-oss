/**
 * Cluster key for a recurring merchant. Keeps only purely-alphabetic tokens after
 * stripping leading digits from each token, so varying alphanumeric reference codes
 * (Spotify's "P32A0291C", Trade Me's "FHG3") are discarded and the stable merchant
 * name remains. E.g. "Spotify P32A0291C" and "Spotify P33800535" both → "spotify";
 * "707-652-3328ADAPT" → "adapt". PocketSmith-origin rows carry the merchant in
 * `description`, so fall back to it when merchant is empty.
 */
export function normaliseMerchant(merchant: string | null, description: string | null): string {
  const raw = (merchant && merchant.trim()) || (description && description.trim()) || "";
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/#\S+/g, " ")               // "#inv-2026-05" reference
    .replace(/[^a-z0-9 ]+/g, " ")        // punctuation incl "*" and "-" → space
    .split(/\s+/)
    .map((t) => t.replace(/^\d+/, ""))   // strip digits glued to the START of a token ("3328adapt" → "adapt")
    .filter((t) => /^[a-z]+$/.test(t))   // keep ONLY purely-alphabetic tokens (drops "p32a0291c", "fhg3", bare numbers)
    .join(" ")
    .trim();
}

export interface DetectTxn {
  id: string;
  occurred_at: string;
  amount: number;
  merchant: string | null;
  description: string | null;
  category_id: string | null;
  categoryKind?: string | null;
}

export type Cadence = "weekly" | "fortnightly" | "monthly" | "quarterly" | "annual";

export interface DetectedSubscription {
  merchantKey: string;
  displayName: string;
  categoryId: string | null;
  cadence: Cadence;
  amount: number;
  amountMin: number;
  amountMax: number;
  firstSeen: string;
  lastSeen: string;
  nextExpected: string;
  occurrences: number;
  status: "active" | "lapsed";
  txnIds: string[];
}

export interface DuplicateCharge {
  merchantKey: string;
  windowStart: string;
  txnIds: string[];
  amount: number;
}

export interface DetectResult {
  subscriptions: DetectedSubscription[];
  duplicates: DuplicateCharge[];
}

export const MIN_OCCURRENCES = 3;
export const STATUS_ACTIVE_FACTOR = 1.5;
export const DROP_AFTER_CYCLES = 3; // stop surfacing a sub once its last charge is older than this many cadence-cycles
export const DUPLICATE_WINDOW_FRACTION = 0.4;
export const PRICE_TOLERANCE_PCT = 0.15;
export const PRICE_TOLERANCE_FLOOR = 2;
export const MAX_AMOUNT_RATIO = 3; // a subscription's max charge must be ≤ this × its min charge

const CADENCE_BANDS: ReadonlyArray<[Cadence, number, number, number]> = [
  ["weekly", 6, 8, 7],
  ["fortnightly", 12, 16, 14],
  ["monthly", 26, 33, 30],
  ["quarterly", 85, 96, 91],
  ["annual", 350, 380, 365],
];

// Minimum interval to consider when falling back to "large" intervals only
// (e.g. months with duplicate charges where intra-pair gaps dominate the median).
// Derived from the weekly band's lower bound — single source of truth.
const CADENCE_MIN_DAYS = CADENCE_BANDS[0][1];

const EXCLUDED_KINDS = new Set(["transfer", "income", "business_subsidy", "system"]);

/**
 * Human-friendly display name from a raw merchant/description: keep the leading
 * brand words, dropping everything from the first token that contains a digit
 * (per-charge reference codes, dates, amounts). Falls back to the title-cased
 * merchant key when the raw string leads with a code (e.g. "707-652-3328ADAPT").
 */
function cleanDisplayName(raw: string, fallbackKey: string): string {
  const kept: string[] = [];
  for (const tok of raw.trim().split(/\s+/)) {
    if (/\d/.test(tok)) break;        // first digit-bearing token → stop
    kept.push(tok);
  }
  const name = kept.join(" ").trim();
  if (name) return name;
  // fallback: title-case the normalised key
  return fallbackKey.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
const DAY_MS = 86_400_000;

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function classifyCadence(medianDays: number): [Cadence, number] | null {
  for (const [cad, lo, hi, approx] of CADENCE_BANDS) {
    if (medianDays >= lo && medianDays <= hi) return [cad, approx];
  }
  return null;
}

export function priceTolerance(amount: number): number {
  return Math.max(Math.abs(amount) * PRICE_TOLERANCE_PCT, PRICE_TOLERANCE_FLOOR);
}

// Brand = the first alphabetic token of the normalised key (e.g. "disney plus" → "disney").
function brandOf(key: string): string {
  return key.split(" ")[0] ?? key;
}

/**
 * Fold small merchant-string fragments into the larger subscription they belong
 * to. A "fragment" is a cluster with fewer than MIN_OCCURRENCES charges (e.g. a
 * lone "Disney" or "Kindle" whose descriptor dropped the usual suffix). Each
 * fragment is absorbed into the largest ANCHOR (a cluster with >= MIN_OCCURRENCES)
 * that shares its brand (first token) AND price point (median abs amount within
 * priceTolerance). Anchors are NEVER merged with each other — so distinct
 * same-brand subscriptions (Kindle Unlimited vs Kindle book purchases, or two
 * different ~$16 Google subs) stay separate, and we can't chain a brand into one
 * blob. Fragments with no matching anchor are left as their own group (and will
 * simply fail the >= MIN_OCCURRENCES qualification later).
 */
function mergeBrandClusters(groups: Map<string, DetectTxn[]>): Map<string, DetectTxn[]> {
  interface Entry {
    key: string;
    txns: DetectTxn[];
    brand: string;
    med: number;
    absorbed?: boolean;
  }

  const entries: Entry[] = [...groups.entries()].map(([key, txns]) => ({
    key,
    txns: [...txns],
    brand: brandOf(key),
    med: median(txns.map((t) => Math.abs(t.amount))),
  }));

  const anchors = entries.filter((e) => e.txns.length >= MIN_OCCURRENCES);
  const fragments = entries.filter((e) => e.txns.length < MIN_OCCURRENCES);

  for (const f of fragments) {
    if (!f.brand) continue;
    // candidate anchors: same brand, price within tolerance
    const candidates = anchors.filter(
      (a) =>
        a.brand === f.brand &&
        Math.abs(a.med - f.med) <= priceTolerance(Math.max(a.med, f.med)),
    );
    if (candidates.length === 0) continue; // no anchor → leave fragment as its own group
    // absorb into the largest candidate (most charges)
    const target = candidates.reduce((best, a) => (a.txns.length > best.txns.length ? a : best));
    target.txns.push(...f.txns);
    f.absorbed = true;
  }

  const merged = new Map<string, DetectTxn[]>();
  for (const a of anchors) merged.set(a.key, a.txns);
  for (const f of fragments) {
    if (!f.absorbed) merged.set(f.key, f.txns);
  }
  return merged;
}

function addCadence(d: Date, cadence: Cadence): Date {
  const out = new Date(d);
  switch (cadence) {
    case "weekly": out.setDate(out.getDate() + 7); break;
    case "fortnightly": out.setDate(out.getDate() + 14); break;
    case "monthly": out.setMonth(out.getMonth() + 1); break;
    case "quarterly": out.setMonth(out.getMonth() + 3); break;
    case "annual": out.setFullYear(out.getFullYear() + 1); break;
  }
  return out;
}

export function detectSubscriptions(txns: DetectTxn[], now: Date = new Date()): DetectResult {
  const spend = txns.filter(
    (t) => t.amount < 0 && t.category_id && !EXCLUDED_KINDS.has(t.categoryKind ?? ""),
  );

  const groups = new Map<string, DetectTxn[]>();
  for (const t of spend) {
    const key = normaliseMerchant(t.merchant, t.description);
    if (!key) continue;
    const arr = groups.get(key);
    if (arr) arr.push(t);
    else groups.set(key, [t]);
  }

  const mergedGroups = mergeBrandClusters(groups);

  const subscriptions: DetectedSubscription[] = [];
  const duplicates: DuplicateCharge[] = [];

  for (const [key, members] of mergedGroups) {
    if (members.length < MIN_OCCURRENCES) continue;
    const sorted = [...members].sort(
      (a, b) => +new Date(a.occurred_at) - +new Date(b.occurred_at),
    );
    const dates = sorted.map((t) => new Date(t.occurred_at));
    const intervals: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      intervals.push((+dates[i] - +dates[i - 1]) / DAY_MS);
    }
    // Primary classification on all intervals; fall back to "large" intervals
    // only (> min cadence lower bound) to handle months with duplicate charges
    // where the short intra-pair gaps dominate the raw median.
    let cls = classifyCadence(median(intervals));
    if (!cls) {
      const largeIntervals = intervals.filter((d) => d >= CADENCE_MIN_DAYS);
      if (largeIntervals.length >= 2) cls = classifyCadence(median(largeIntervals));
    }
    if (!cls) continue;
    const [cadence, approxDays] = cls;

    const amounts = sorted.map((t) => Math.abs(t.amount));
    const canonical = round2(median(amounts));
    const amountMin = round2(Math.min(...amounts));
    const amountMax = round2(Math.max(...amounts));

    // Reject merchants whose price range is too wide to be a fixed-price subscription
    // (e.g. PayPal or Apple where charges span $1–$161).
    if (amountMin > 0 && amountMax > amountMin * MAX_AMOUNT_RATIO) continue;

    const first = dates[0];
    const last = dates[dates.length - 1];
    const ageDays = (+now - +last) / DAY_MS;
    const status: "active" | "lapsed" =
      ageDays <= approxDays * STATUS_ACTIVE_FACTOR ? "active" : "lapsed";

    if (ageDays > DROP_AFTER_CYCLES * approxDays) continue; // stale beyond the drop horizon — don't surface

    const counts = new Map<string, number>();
    for (const t of sorted) {
      const rawName = (t.merchant && t.merchant.trim()) || (t.description && t.description.trim()) || key;
      const name = cleanDisplayName(rawName, key);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const displayName = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    subscriptions.push({
      merchantKey: key,
      displayName,
      categoryId: sorted[sorted.length - 1].category_id,
      cadence,
      amount: canonical,
      amountMin,
      amountMax,
      firstSeen: isoDate(first),
      lastSeen: isoDate(last),
      nextExpected: isoDate(addCadence(last, cadence)),
      occurrences: sorted.length,
      status,
      txnIds: [...sorted].reverse().map((t) => t.id),
    });

    const tol = priceTolerance(canonical);
    const closeThreshold = approxDays * DUPLICATE_WINDOW_FRACTION;
    const dupWindows = new Map<string, Set<string>>();
    for (let i = 1; i < sorted.length; i++) {
      const gap = (+dates[i] - +dates[i - 1]) / DAY_MS;
      const aClose = Math.abs(Math.abs(sorted[i].amount) - canonical) <= tol;
      const bClose = Math.abs(Math.abs(sorted[i - 1].amount) - canonical) <= tol;
      if (gap < closeThreshold && aClose && bClose) {
        const windowStart = isoDate(dates[i - 1]);
        const set = dupWindows.get(windowStart) ?? new Set<string>();
        set.add(sorted[i - 1].id);
        set.add(sorted[i].id);
        dupWindows.set(windowStart, set);
      }
    }
    for (const [windowStart, ids] of dupWindows) {
      duplicates.push({ merchantKey: key, windowStart, txnIds: [...ids], amount: canonical });
    }
  }

  return { subscriptions, duplicates };
}
