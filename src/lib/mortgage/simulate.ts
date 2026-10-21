// Monthly amortisation simulation — the single source of truth for "mortgage-free
// when?" and for fix-vs-float / extra-repayment scenarios. A plain month-by-month
// loop (not a closed form) so it can handle a rate change at refix, an extra
// recurring payment, and a one-off lump sum in the same pass.
//
// Rates are annual percentages (e.g. 4.99 → 4.99% p.a.); the monthly rate is
// rate/12/100. All money in NZD.

// Hard guard so a payment that never clears the balance terminates the loop.
const MAX_MONTHS = 1200; // 100 years

export interface SimInput {
  balance: number; // current owing (positive magnitude)
  monthlyPayment: number; // scheduled repayment per month
  annualRate: number; // current fixed/floating rate, % p.a.
  // Optional refix: from `refixAfterMonths` onward, switch to `refixAnnualRate`.
  refixAfterMonths?: number;
  refixAnnualRate?: number;
  // Optional scenario levers.
  extraPerMonth?: number; // additional principal every month
  lumpSum?: number; // one-off payment applied immediately
}
export interface SimResult {
  monthsRemaining: number | null; // null = payment never clears the balance
  totalInterest: number; // interest paid over the life of the loan
}

export function simulateTranche(input: SimInput): SimResult {
  let balance = Math.max(0, input.balance) - Math.max(0, input.lumpSum ?? 0);
  if (balance <= 0) return { monthsRemaining: 0, totalInterest: 0 };

  const pay = Math.max(0, input.monthlyPayment) + Math.max(0, input.extraPerMonth ?? 0);
  let interestPaid = 0;

  for (let m = 0; m < MAX_MONTHS; m++) {
    const useRefix =
      input.refixAfterMonths != null &&
      input.refixAnnualRate != null &&
      m >= input.refixAfterMonths;
    const annual = useRefix ? input.refixAnnualRate! : input.annualRate;
    const r = Math.max(0, annual) / 12 / 100;

    const interest = balance * r;
    // Payment can't cover interest → balance never falls (unless a future refix
    // lowers it, which the loop would discover; the MAX_MONTHS guard bounds it).
    if (pay <= interest && r > 0 && input.refixAnnualRate == null) {
      return { monthsRemaining: null, totalInterest: Math.round(interestPaid * 100) / 100 };
    }
    if (pay <= 0) return { monthsRemaining: null, totalInterest: Math.round(interestPaid * 100) / 100 };

    const principal = pay - interest;
    if (principal <= 0) {
      // No progress this month; keep going only if a refix is still ahead.
      if (input.refixAfterMonths != null && m < input.refixAfterMonths) {
        interestPaid += interest;
        continue;
      }
      return { monthsRemaining: null, totalInterest: Math.round(interestPaid * 100) / 100 };
    }

    if (principal >= balance) {
      // Final (partial) month: only the outstanding balance accrues/clears.
      interestPaid += balance * r;
      return { monthsRemaining: m + 1, totalInterest: Math.round(interestPaid * 100) / 100 };
    }
    interestPaid += interest;
    balance -= principal;
  }
  return { monthsRemaining: null, totalInterest: Math.round(interestPaid * 100) / 100 };
}

// Add whole months to a date, return "YYYY-MM".
export function monthsToYM(now: Date, months: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
