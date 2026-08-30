// The FinOps "Flow Bar" brand mark — income (green, left) meets spend
// (terracotta, right) in a single bar. Per the brand guidelines the geometry
// never changes; only the colour pair swaps: the deeper pair on light themes,
// the brighter pair on dark themes (handled via Tailwind's `dark:` variant).
export function FinopsMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="FinOps">
      <path
        d="M47 38 H23 A12 12 0 0 0 11 50 A12 12 0 0 0 23 62 H47 Z"
        className="fill-[#1B9A5F] dark:fill-[#34BE7C]"
      />
      <path
        d="M53 38 H77 A12 12 0 0 1 89 50 A12 12 0 0 1 77 62 H53 Z"
        className="fill-[#C5642F] dark:fill-[#E08A57]"
      />
    </svg>
  );
}
