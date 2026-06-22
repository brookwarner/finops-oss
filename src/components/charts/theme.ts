// Central chart colour map. Every chart routes its colours through here, so all
// four stay theme-correct across dark/light/green without per-file literals.
// Theme tokens are stored as space-separated RGB triples (for Tailwind's
// `rgb(var(--x) / <alpha>)`), so we wrap them in rgb() to use directly in SVG
// fills/strokes.
import type { RagStatus } from "@/lib/budgets/compute";

export type ChartRole =
  | "positive"
  | "negative"
  | "warning"
  | "faint"
  | "muted"
  | "surface"
  | "sunken"
  | "hairline"
  | "ink"
  | "violet"
  | "reserve";

const VAR: Record<ChartRole, string> = {
  positive: "--positive-bar",
  negative: "--negative-bar",
  warning: "--warning-bar",
  faint: "--faint",
  muted: "--muted",
  surface: "--surface",
  sunken: "--sunken",
  hairline: "--hairline",
  ink: "--ink",
  violet: "--chart-violet",
  reserve: "--reserve",
};

/** `rgb(var(--token))`, optionally with an alpha in [0, 1]. */
export function chartColor(role: ChartRole, alpha?: number): string {
  const v = `var(${VAR[role]})`;
  return alpha == null ? `rgb(${v})` : `rgb(${v} / ${alpha})`;
}

/** Expense RAG → bar colour role (at/over target is bad). */
export function ragRole(status: RagStatus): ChartRole {
  if (status === "over") return "negative";
  if (status === "warning") return "warning";
  return "positive";
}

/**
 * Income RAG is inverted vs expenses: at/above target is good (green), short is
 * bad (red). Mirrors incomeColor() on the budgets page.
 */
export function incomeRole(pctOfTarget: number): ChartRole {
  if (pctOfTarget >= 100) return "positive";
  if (pctOfTarget >= 80) return "warning";
  return "negative";
}
