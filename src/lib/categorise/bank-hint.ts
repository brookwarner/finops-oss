// src/lib/categorise/bank-hint.ts
//
// Bank-hint layer: map Akahu's own transaction category to one of our
// categories where there is a confident 1:1 correspondence. Evaluated after
// rule layers and before the LLM. Keyed by Akahu category NAME (stable across
// databases) → our category NAME; resolved to our category IDs at load time.
//
// Only unambiguous mappings live here. Ambiguous Akahu categories (e.g.
// "Convenience stores", "Local government", "Sports equipment and supplies")
// are deliberately excluded so they fall through to the LLM fallback.

export const BANK_HINT_BY_NAME: Record<string, string> = {
  "Supermarkets and grocery stores": "Groceries",
  "Meal kit stores": "Groceries",
  "Fuel stations": "Gasoline/Fuel",
  "Cafes and restaurants": "Restaurants/Dining/Snacks",
  "Fast food stores": "Restaurants/Dining/Snacks",
  "Ice cream, gelato, nut, and confectionary stores": "Restaurants/Dining/Snacks",
  "Liquor stores": "Alcohol",
  "Bus and shuttle transport services": "Public Transport",
  "Parking services": "Parking",
  "Telecommunication services": "Telephone Services",
  "Electricity services": "Power",
  "Water and sanitation services": "Water",
  "Media and entertainment streaming services": "Online Services",
  "Pharmacies": "Healthcare/Medical",
  "Doctors and physicians": "Healthcare/Medical",
  "Chiropodists and podiatrists": "Healthcare/Medical",
  "Insurance": "Insurance",
  "Financial asset brokers, exchanges, and managed funds": "Investments",
  "General retail stores": "General Merchandise",
  "Automotive parts and accessories": "Vehicles",
  "Welfare and charity": "Donations",
  "Entertainment (not elsewhere classified)": "Entertainment",
  "Attractions, museums, zoos, amusement parks, circuses, exhibits": "Entertainment",
  "Motor parks, campgrounds, holiday parks, recreational camps": "Holidays",
};

/**
 * Resolve BANK_HINT_BY_NAME against the household's categories, producing a
 * lookup of Akahu-category-name → our category_id. Mappings whose target
 * category name does not exist are silently dropped (defensive against
 * taxonomy edits).
 */
export function resolveBankHint(
  categories: { id: string; name: string }[],
): Record<string, string> {
  const idByName = new Map(categories.map((c) => [c.name, c.id]));
  const out: Record<string, string> = {};
  for (const [akahuName, ourName] of Object.entries(BANK_HINT_BY_NAME)) {
    const id = idByName.get(ourName);
    if (id) out[akahuName] = id;
  }
  return out;
}
