#!/usr/bin/env python3
"""Import PocketSmith historical transactions into the transactions table.

Reads data/pocketsmith/pocketsmith-search-categorized.csv and emits chunked
SQL to /tmp/finops_psimport/. Each transaction:
  - akahu_transaction_id = 'ps_<PocketSmith ID>'  (idempotent upsert key)
  - account_id           = the synthetic "PocketSmith History" account
  - amount               = PocketSmith Amount, verbatim. PocketSmith signs from
                           the user's perspective (negative = money out), and
                           the synthetic account is an asset type, so the budget
                           page's `outflow = -amount` math comes out right.
  - description          = PocketSmith Merchant (raw bank text)
  - category_id          = mapped from PocketSmith Category via ALIAS
  - is_manual_category   = true  (PocketSmith's categorisations are authoritative;
                           the auto-engine must not clobber them)
  - raw                  = '{}'

Usage:
    python3 scripts/import_pocketsmith.py <synthetic_account_id>
"""
import csv
import os
import sys

CSV_PATH = os.environ.get("PS_CSV", "data/pocketsmith/pocketsmith-search-categorized.csv")
HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001"
OUT_DIR = os.environ.get("PS_OUT_DIR", "/tmp/finops_psimport")
CHUNK = int(os.environ.get("PS_CHUNK", "800"))

# PocketSmith category name -> our seeded category name. None = leave
# uncategorised (category_id null).
ALIAS = {
    "Salary": "Salary", "Other Income": "Other Income", "Partner ECE Income": "Partner ECE Income",
    "Interest": "Interest Income", "Business Income": "Business Income",
    "Groceries": "Groceries", "Restaurants/Dining/Snacks": "Restaurants/Dining/Snacks",
    "Entertainment": "Entertainment", "Hobbies": "Hobbies", "Date Nights": "Date Nights",
    "Clothing/Shoes": "Clothing/Shoes", "General Merchandise": "General Merchandise",
    "Online Services": "Online Services", "Alcohol": "Alcohol", "Gifts": "Gifts",
    "Holidays": "Holidays", "Education": "Education", "Sports & Recreation": "Sports & Recreation",
    "Allowances": "Allowances", "Healthcare/Medical": "Healthcare/Medical",
    "Pets/Pet Care": "Pets/Pet Care", "Haircuts": "Haircuts", "Public Transport": "Public Transport",
    "Gasoline/Fuel": "Gasoline/Fuel", "Parking": "Parking", "Home Maintenance": "Home Maintenance",
    "Vehicles": "Vehicles", "Home Improvement": "Home Improvement", "Power": "Power",
    "Water": "Water", "Telephone Services": "Telephone Services", "Rates": "Rates",
    "Service Charges/Fees": "Service Charges/Fees", "Insurance": "Insurance",
    "Caravan Repayments": "Caravan Repayments", "Donations": "Donations",
    "Credit Card Repayments": "Credit Card Repayments", "Debt Repayments": "Debt Repayments",
    "Mortgage Part 1": "Mortgage Part 1", "Mortgage Part 2": "Mortgage Part 2",
    "Mortgage Part 3": "Mortgage Part 3", "Investments": "Investments",
    "Savings": "Savings Out", "Savings Out": "Savings Out", "Bush Base": "Bush Base",
    "Business Expenses": "Business Expenses", "Transfers": "Transfers", "Taxes": "Taxes",
    "Mortgage Interest": "Mortgage Interest",
    "Mortgage Repayments Outgoing": "Transfers", "Mortgage Transfer (Credit)": "Transfers",
    # Parent-group bins — leave uncategorised.
    "Discretionary": None, "Kids": None, "Wellbeing": None, "Maintenance": None,
    "Transit": None, "Utilities": None,
}


def q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: import_pocketsmith.py <account_id>", file=sys.stderr)
        sys.exit(1)
    account_id = sys.argv[1]

    with open(CSV_PATH, newline="") as f:
        rows = list(csv.DictReader(f))

    os.makedirs(OUT_DIR, exist_ok=True)
    for f in os.listdir(OUT_DIR):
        os.remove(os.path.join(OUT_DIR, f))

    records = []
    skipped_unmapped = 0
    for r in rows:
        ext = (r.get("ID") or "").strip()
        date = (r.get("Date") or "").strip()
        amt = (r.get("Amount") or "").strip()
        if not ext or not date or not amt:
            continue
        merch = (r.get("Merchant") or "").strip()
        ps_cat = (r.get("Category") or "").strip()
        mapped = ALIAS.get(ps_cat, "__UNKNOWN__")
        if mapped == "__UNKNOWN__":
            skipped_unmapped += 1
            mapped = None  # still import, just uncategorised
        records.append((f"ps_{ext}", date, amt, merch, mapped))

    n_chunks = 0
    for i in range(0, len(records), CHUNK):
        chunk = records[i:i + CHUNK]
        n_chunks += 1
        with open(f"{OUT_DIR}/{n_chunks:02d}.sql", "w") as fh:
            fh.write(
                "insert into transactions "
                "(household_id, account_id, akahu_transaction_id, occurred_at, amount, "
                "akahu_type, description, merchant, category_id, is_manual_category, raw)\n"
                "select\n"
                f"  {q(HOUSEHOLD_ID)}::uuid, {q(account_id)}::uuid, v.ext_id, v.dt::timestamptz, "
                "v.amt::numeric, 'pocketsmith', v.descr, null, c.id, true, '{}'::jsonb\n"
                "from (values\n"
            )
            parts = []
            for ext_id, dt, amt, merch, cat in chunk:
                cat_sql = q(cat) if cat else "null"
                parts.append(f"  ({q(ext_id)}, {q(dt)}, {q(amt)}, {q(merch)}, {cat_sql})")
            fh.write(",\n".join(parts))
            fh.write("\n) as v(ext_id, dt, amt, descr, cat_name)\n")
            fh.write(
                f"left join categories c on c.household_id = {q(HOUSEHOLD_ID)} and c.name = v.cat_name\n"
            )
            fh.write("on conflict (akahu_transaction_id) do nothing;\n")

    print(f"{len(records)} records -> {n_chunks} chunks in {OUT_DIR} "
          f"({skipped_unmapped} unmapped categories left null)")


if __name__ == "__main__":
    main()
