// Shared loading skeleton for every tab under (app). Because each tab page is
// `force-dynamic`, navigation otherwise blocks on the full server render with no
// visual feedback — the old screen just freezes. This Suspense fallback paints
// instantly on tap (the header + bottom nav from the layout stay mounted), so
// navigation feels native while the destination's data resolves. Adding it also
// re-enables meaningful <Link prefetch> up to this boundary.
const Block = ({ className = "" }: { className?: string }) => (
  <div className={`rounded bg-hairline ${className}`} />
);

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-card bg-surface p-5 shadow-card">{children}</div>
);

export default function AppLoading() {
  return (
    <div className="animate-pulse" aria-hidden="true">
      {/* Page title */}
      <Block className="mb-5 h-7 w-40" />

      {/* Hero card */}
      <div className="mb-6">
        <Card>
          <Block className="mb-3 h-3 w-24" />
          <Block className="mb-4 h-8 w-48" />
          <Block className="h-2 w-full" />
        </Card>
      </div>

      {/* List rows */}
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-card bg-surface p-4 shadow-card"
          >
            <div className="flex-1 space-y-2">
              <Block className="h-3 w-28" />
              <Block className="h-2 w-20" />
            </div>
            <Block className="h-6 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
