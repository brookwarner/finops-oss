"use client";

import { useTooltip } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import type { PointerEvent as ReactPointerEvent } from "react";

// Shared tap/hover tooltip logic for every chart — this is what makes the four
// charts behave consistently. Touch-first: Pointer Events cover mouse and touch
// uniformly, so a tap on mobile and a hover on desktop run the same path. The
// caller supplies the data array plus accessors for each datum's pixel x/y; on
// move or tap we bisect to the nearest datum by x and surface it. Tap-away /
// pointer-leave dismisses.
export function useChartTooltip<T>({
  data,
  getX,
  getY,
}: {
  data: T[];
  /** pixel x of the datum within the SVG */
  getX: (d: T, i: number) => number;
  /** pixel y of the datum within the SVG */
  getY: (d: T, i: number) => number;
}) {
  const tt = useTooltip<T>();

  function locate(e: ReactPointerEvent<Element>) {
    const p = localPoint(e.currentTarget as Element, e);
    if (!p || data.length === 0) return;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < data.length; i++) {
      const dist = Math.abs(getX(data[i], i) - p.x);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    const d = data[best];
    tt.showTooltip({
      tooltipData: d,
      tooltipLeft: getX(d, best),
      tooltipTop: getY(d, best),
    });
  }

  const handlers = {
    onPointerMove: locate,
    onPointerDown: locate,
    onPointerLeave: () => tt.hideTooltip(),
  };

  return { ...tt, handlers };
}
