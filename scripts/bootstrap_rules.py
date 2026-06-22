#!/usr/bin/env python3
"""Bootstrap category_rules from a PocketSmith categorised transactions export.

Reads data/pocketsmith/pocketsmith-search-categorized.csv, groups by Merchant,
keeps merchants with a clearly dominant PocketSmith category (>=80% of that
merchant's transactions agree), maps the category name to our seeded category
via an alias table, and emits SQL INSERTs into category_rules with
source='bootstrap'. Skips merchants whose PocketSmith category maps to a
parent-group (Discretionary, Kids, Wellbeing, etc) since those are bins, not
real categories — better left for the inbox/LLM to resolve.

Priority encodes confidence: priority = 100 - min(observations, 90), so
high-confidence rules check first. Output is a single SQL file; review it,
then apply.

Usage:
    python3 scripts/bootstrap_rules.py > supabase/migrations/0015_bootstrap_rules.sql
"""
import csv
import sys
from collections import defaultdict, Counter

CSV_PATH = "data/pocketsmith/pocketsmith-search-categorized.csv"
HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001"
DOMINANCE = 0.85
MIN_OBSERVATIONS = 2
# Length of the uppercase stem used as a pattern match against `description`.
# Akahu truncates descriptions to ~20 chars so anything longer won't match.
STEM_LEN = 16

# PocketSmith category name -> our seeded category name.
# Anything mapped to None is intentionally skipped (parent groups, unmodelled).
ALIAS = {
    "Salary": "Salary",
    "Other Income": "Other Income",
    "Partner ECE Income": "Partner ECE Income",
    "Interest": "Interest Income",
    "Business Income": "Business Income",
    "Groceries": "Groceries",
    "Restaurants/Dining/Snacks": "Restaurants/Dining/Snacks",
    "Entertainment": "Entertainment",
    "Hobbies": "Hobbies",
    "Date Nights": "Date Nights",
    "Clothing/Shoes": "Clothing/Shoes",
    "General Merchandise": "General Merchandise",
    "Online Services": "Online Services",
    "Alcohol": "Alcohol",
    "Gifts": "Gifts",
    "Holidays": "Holidays",
    "Education": "Education",
    "Sports & Recreation": "Sports & Recreation",
    "Allowances": "Allowances",
    "Healthcare/Medical": "Healthcare/Medical",
    "Pets/Pet Care": "Pets/Pet Care",
    "Haircuts": "Haircuts",
    "Public Transport": "Public Transport",
    "Gasoline/Fuel": "Gasoline/Fuel",
    "Parking": "Parking",
    "Home Maintenance": "Home Maintenance",
    "Vehicles": "Vehicles",
    "Home Improvement": "Home Improvement",
    "Power": "Power",
    "Water": "Water",
    "Telephone Services": "Telephone Services",
    "Rates": "Rates",
    "Service Charges/Fees": "Service Charges/Fees",
    "Insurance": "Insurance",
    "Caravan Repayments": "Caravan Repayments",
    "Donations": "Donations",
    "Credit Card Repayments": "Credit Card Repayments",
    "Debt Repayments": "Debt Repayments",
    "Mortgage Part 1": "Mortgage Part 1",
    "Mortgage Part 2": "Mortgage Part 2",
    "Mortgage Part 3": "Mortgage Part 3",
    "Investments": "Investments",
    "Savings": "Savings Out",
    "Savings Out": "Savings Out",
    "Bush Base": "Bush Base",
    "Business Expenses": "Business Expenses",
    "Transfers": "Transfers",
    "Taxes": "Taxes",
    # Parent-groups: skip, let the inbox catch them.
    "Discretionary": None,
    "Kids": None,
    "Wellbeing": None,
    "Maintenance": None,
    "Transit": None,
    "Utilities": None,
    # P&I splits — leave to the mortgage-specific handling.
    "Mortgage Interest": None,
    "Mortgage Repayments Outgoing": "Transfers",
    "Mortgage Transfer (Credit)": "Transfers",
}


def sql_quote(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def stem(merchant: str) -> str:
    """Uppercase, strip non-alnum-space, truncate to STEM_LEN. The result is
    what we'll ILIKE-match against Akahu's truncated description."""
    s = "".join(ch if ch.isalnum() or ch == " " else " " for ch in merchant.upper())
    s = " ".join(s.split())  # collapse whitespace
    return s[:STEM_LEN].strip()


def main() -> None:
    # Group PocketSmith rows by *stem* of their merchant text, not the raw
    # merchant. Different PocketSmith merchant strings that collapse to the
    # same stem (e.g. "PAK N SAVE LINCOLN ROA HENDERSON" and "Pak N Save
    # Lincol 21 2685") get pooled — that's exactly the signal we want.
    by_stem: dict[str, Counter[str]] = defaultdict(Counter)
    with open(CSV_PATH, newline="") as f:
        for row in csv.DictReader(f):
            m = (row.get("Merchant") or "").strip()
            c = (row.get("Category") or "").strip()
            if not m or not c:
                continue
            st = stem(m)
            if len(st) < 4:
                continue
            by_stem[st][c] += 1
    by_merchant = by_stem  # rename to fit downstream code

    rules: list[tuple[str, str, int]] = []  # (merchant, our_category_name, observations)
    skipped_unmapped = 0
    skipped_ambiguous = 0
    for merchant, cats in by_merchant.items():
        total = sum(cats.values())
        if total < MIN_OBSERVATIONS:
            continue
        top_cat, top_n = cats.most_common(1)[0]
        if top_n / total < DOMINANCE:
            skipped_ambiguous += 1
            continue
        if top_cat not in ALIAS:
            skipped_unmapped += 1
            continue
        mapped = ALIAS[top_cat]
        if mapped is None:
            continue
        rules.append((merchant, mapped, top_n))

    rules.sort(key=lambda r: (-r[2], r[0]))

    print("-- Bootstrap category_rules from PocketSmith categorised export.")
    print(f"-- Source: {CSV_PATH}")
    print(f"-- Generated rules: {len(rules)} (dominance >= {DOMINANCE:.0%}, min obs {MIN_OBSERVATIONS})")
    print(f"-- Skipped ambiguous merchants: {skipped_ambiguous}")
    print(f"-- Skipped unmapped categories: {skipped_unmapped}")
    print()
    # Wipe prior bootstrap rules so re-running is idempotent. Manual/LLM/
    # curated rules are preserved.
    print(
        f"delete from category_rules where household_id = '{HOUSEHOLD_ID}' "
        f"and source = 'bootstrap';"
    )
    # Pattern rules against the description field. Priority 100 (runs after
    # curated layer at 50). match_value is the uppercase stem; the engine
    # does ILIKE '%stem%' on description.
    print("insert into category_rules (household_id, category_id, match_type, match_value, field, priority, source)")
    print("select")
    print(f"  '{HOUSEHOLD_ID}'::uuid, c.id, 'pattern', v.stem, 'description', v.priority, 'bootstrap'")
    print("from categories c")
    print("join (values")
    parts = []
    seen_stems = set()
    for stem_str, mapped, obs in rules:
        if stem_str in seen_stems:
            continue
        seen_stems.add(stem_str)
        priority = max(60, 100 - min(obs, 40))  # min priority 60 so curated wins
        parts.append(f"  ({sql_quote(stem_str)}, {sql_quote(mapped)}, {priority})")
    print(",\n".join(parts))
    print(") as v(stem, cat_name, priority) on v.cat_name = c.name")
    print(f"where c.household_id = '{HOUSEHOLD_ID}';")


if __name__ == "__main__":
    main()
