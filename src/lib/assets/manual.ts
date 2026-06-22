/** A manual asset is an `accounts` row whose id is minted by this module.
 * Convention (no migration): akahu_account_id starts with "manual_" and
 * attributes is empty. Akahu sync never returns these ids, so they are safe. */

export const ALLOWED_TYPES = new Set(["other", "investment", "savings", "receivable"]);
/** Types that feed the FI pool (see src/lib/fi/constants.ts FI_ASSET_TYPES).
 * Surfaces flag these so the user knows the row nudges the FI number. */
export const FI_FEEDING_TYPES = new Set(["investment", "savings"]);

export interface ManualAssetInput {
  name: string;
  balance: number;
  type?: string;
  currency?: string;
  institution?: string;
}

export interface ValidatedAsset {
  name: string;
  balance: number;
  type: string;
  currency: string;
  institution: string;
}

export function isManualId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("manual_");
}

export function slugify(name: string): string {
  const kebab = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `manual_${kebab || "asset"}`;
}

export function mintId(name: string, existingIds: Set<string>): string {
  const base = slugify(name);
  if (!existingIds.has(base)) return base;
  let n = 2;
  while (existingIds.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

export type ValidateResult =
  | { ok: true; value: ValidatedAsset }
  | { ok: false; error: string };

export function validateAsset(input: ManualAssetInput): ValidateResult {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "name is required" };
  if (typeof input.balance !== "number" || !Number.isFinite(input.balance)) {
    return { ok: false, error: "balance must be a finite number" };
  }
  const type = input.type ?? "other";
  if (!ALLOWED_TYPES.has(type)) {
    return { ok: false, error: `type must be one of ${[...ALLOWED_TYPES].join(", ")}` };
  }
  const currency = (input.currency ?? process.env.DEFAULT_CURRENCY ?? "NZD").toUpperCase();
  const institution = (input.institution ?? "Manual").trim() || "Manual";
  return { ok: true, value: { name, balance: input.balance, type, currency, institution } };
}
