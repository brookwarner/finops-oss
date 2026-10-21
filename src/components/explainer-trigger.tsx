"use client";

import { InfoSheet } from "./info-sheet";
import type { Explainer } from "@/lib/explainers/budget-hero";

// The ⓘ affordance on a budget hero widget. The page is an async server
// component, so the explainer content is built server-side (the builders are
// pure → plain serialisable data) and passed in; this island just adapts that
// `Explainer` into the canonical InfoSheet (trigger + bottom sheet), rendering
// each number on the card mapped to a plain-English meaning.
export function ExplainerTrigger({
  explainer,
  className = "",
}: {
  explainer: Explainer;
  className?: string;
}) {
  return (
    <InfoSheet
      title={explainer.title}
      answers={explainer.answers}
      triggerClassName={className}
    >
      <dl className="space-y-3.5">
        {explainer.rows.map((row, i) => (
          <div
            key={i}
            className="border-t border-hairline pt-3.5 first:border-t-0 first:pt-0"
          >
            <dt className="text-sm font-semibold tabular-nums text-ink">{row.line}</dt>
            <dd className="mt-0.5 text-sm leading-snug tabular-nums text-ink-muted">
              {row.meaning}
            </dd>
          </div>
        ))}
      </dl>
    </InfoSheet>
  );
}
