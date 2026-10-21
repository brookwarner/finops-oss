// src/lib/allocation/constants.ts

/** ASB Visa Light purchase APR. Not exposed by Akahu, so it's a configured
 *  constant — the single place to change it. Revolving card debt at this rate is
 *  the highest guaranteed "return" available, so it's always cleared first. */
export const VISA_APR = 0.1995;

/** Westpac Choices revolving facility debit rate (Everyday Floating, % as a
 *  FRACTION — 0.0569 = 5.69% p.a.). Floating and not exposed by Akahu, so it's a
 *  configured constant — the single place to change it at each rate move. The
 *  facility is non-reducing/redrawable, so paying it down is a reversible
 *  guaranteed return; the cascade ranks it just above the fixed mortgage. */
export const CHOICES_REVOLVING_RATE = 0.0569;

/** Assumed long-run inflation, used to lift the FI engine's REAL return (3.5%)
 *  onto a NOMINAL basis so it compares like-for-like with the nominal mortgage
 *  rate. ~7% nominal − 3.5% inflation = 3.5% real (matches REAL_RETURN). */
export const ASSUMED_INFLATION = 0.035;
