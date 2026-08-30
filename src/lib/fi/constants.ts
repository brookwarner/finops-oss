// src/lib/fi/constants.ts

/** Safe withdrawal rate — the 4% rule. FI number = annual spend ÷ SWR. */
export const SWR = 0.04;

/** Default real (after-inflation) annual return, today's-dollars. Spreadsheet
 *  Base macro: ~7% nominal − 3.5% inflation. */
export const REAL_RETURN = 0.035;

/** the owner. Used for FI age. */
export const DOB = new Date(Date.UTC(1986, 8, 10)); // 10 Sep 1986
export const FI_TARGET_AGE = 50;                     // FI target year 2036
export const NZ_SUPER_AGE = 65;                      // KiwiSaver unlock framing

/** Trailing window (months) for the observed savings contribution. */
export const CONTRIBUTION_WINDOW_MONTHS = 3;

/** Account types that count toward FI (liquid + invested). Home, everyday cash,
 *  loans, credit, wallets, and KiwiSaver (locked until 65) are excluded. */
export const FI_ASSET_TYPES = new Set(["savings", "investment"]);

/** Category kinds that count as recurring living spend for the FI number.
 *  Excludes transfer (mortgage principal, internal moves), reserve (sinking
 *  funds = lumpy one-offs), income, system, business_subsidy. Mortgage interest
 *  is ap_amortised → included. */
export const RECURRING_SPEND_KINDS = new Set(["monthly_cap", "ap_amortised"]);

/** Projection horizon cap: 600 months = 50 years. Beyond → "not reached". */
export const CAP_MONTHS = 600;

/** Reserve-kind categories whose OUTFLOWS count as FI contributions — money
 *  routed into investment vehicles that Akahu can't give a transaction feed for
 *  (e.g. Sharesies: deposit leaves checking, auto-buys shares within a day, and
 *  the holding lands in an account with `Txns: never`). Counted from the cash
 *  side so market movement never contaminates the savings signal. The kids'
 *  Sharesies live in a separate category ("Kids' investments") and are excluded. */
export const FI_CONTRIBUTION_CATEGORIES = new Set(["Investments"]);
