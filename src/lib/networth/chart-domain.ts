// y-axis domain for the net-worth sparkline. Hybrid scaling: autoscale to the
// data, but never zoom tighter than a minimum band sized as a fraction of
// net-worth magnitude. Without the floor the chart stretches any movement — even
// a 0.1% wiggle — to fill the full height, so a trivial change reads as a cliff.
// With it, genuinely flat periods render flat while real swings (which exceed
// the floor) still show their shape. Returns [lo, hi].
const MIN_BAND_FRAC = 0.04; // a sub-4%-of-net-worth window looks ~flat, as it should

export function netWorthDomain(nets: number[]): [number, number] {
  const min = Math.min(...nets);
  const max = Math.max(...nets);
  const magnitude = Math.max(Math.abs(min), Math.abs(max), 1);
  const mid = (min + max) / 2;
  const band = Math.max(max - min, magnitude * MIN_BAND_FRAC);
  return [mid - band / 2, mid + band / 2];
}
