// Minimal read-only client for the public homes.co.nz HomesEstimate (HEV).
// Ports the `property` path of the local `homes-nz` skill CLI: fetch the property
// card from the gateway and read its automated `estimated_value`, falling back to
// the details endpoint. No login or API key required.

const BASE_WEB = "https://homes.co.nz";
const BASE_GATEWAY = "https://gateway.homes.co.nz";
const BASE_API = "https://api-gateway.homes.co.nz";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

export interface HomesEstimate {
  value: number;
  lower: number | null;
  upper: number | null;
  revisionDate: string | null;
}

async function getJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json, text/plain, */*",
        Origin: BASE_WEB,
        Referer: BASE_WEB + "/",
        "User-Agent": UA,
      },
      // homes.co.nz data changes slowly; don't let Next cache a stale estimate.
      cache: "no-store",
    });
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(`homes.co.nz request timed out (10s) for ${url}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`homes.co.nz HTTP ${res.status} from ${url}`);
  }
  return res.json();
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const shortDate = (v: unknown): string | null =>
  typeof v === "string" && v ? v.slice(0, 10) : null;

/**
 * Fetch the current HomesEstimate for a homes.co.nz property id.
 * Throws if no public estimate is available.
 */
export async function fetchHomesEstimate(propertyId: string): Promise<HomesEstimate> {
  const id = encodeURIComponent(propertyId);

  // Primary: the details endpoint carries the numeric estimate fields. (The
  // gateway card only exposes display strings like "945K", not raw numbers.)
  const detail = (await getJson(`${BASE_API}/details?property_id=${id}`))?.property ?? {};
  let value = num(detail.estimated_value);
  let lower = num(detail.estimated_lower_value);
  let upper = num(detail.estimated_upper_value);
  let revisionDate = shortDate(detail.estimated_value_revision_date);

  // Fallback: for off-market homes (state 2) the gateway card's `price` mirrors
  // the estimate — the same fallback the homes-nz skill uses.
  if (value === null) {
    const cards = await getJson(`${BASE_GATEWAY}/properties?property_ids=${id}`);
    const card = (cards?.cards ?? []).find(
      (c: any) => c && (c.property_id === propertyId || c.id === propertyId),
    );
    const pd = card?.property_details ?? {};
    value = num(pd.estimated_value) ?? (card?.state === 2 ? num(card.price) : null);
    lower = lower ?? num(pd.estimated_lower_value);
    upper = upper ?? num(pd.estimated_upper_value);
    revisionDate = revisionDate ?? shortDate(pd.estimated_value_revision_date);
  }

  if (value === null) {
    throw new Error(`no public HomesEstimate found for property ${propertyId}`);
  }
  return { value, lower, upper, revisionDate };
}
