"use client";

import type { ReactNode } from "react";
import { chartColor, type ChartRole } from "./theme";

// Themed tooltip card shared by every chart: calm surface, hairline border,
// tabular numerals. Positioned by the caller via left/top (pixel coords inside
// the chart's relative wrapper) and clamped horizontally so it never spills past
// the chart edges. Rendered as a plain absolutely-positioned div rather than
// visx's TooltipWithBounds — that component is a legacy React class component
// whose type signature is incompatible with @types/react@19's JSX. The visx
// hooks (useTooltip) and SVG primitives we use are all React-19-safe.
const HALF_W = 62; // approx half tooltip width, for edge clamping

export function ChartTooltip({
  left,
  top,
  width,
  children,
}: {
  left: number;
  top: number;
  /** chart width, so the card can be clamped inside it */
  width: number;
  children: ReactNode;
}) {
  const clampedLeft = Math.max(HALF_W, Math.min(width - HALF_W, left));
  return (
    <div
      style={{
        position: "absolute",
        left: clampedLeft,
        top,
        transform: "translate(-50%, calc(-100% - 8px))",
        pointerEvents: "none",
        background: chartColor("surface"),
        border: `1px solid ${chartColor("hairline")}`,
        borderRadius: 8,
        padding: "4px 8px",
        fontSize: 11,
        lineHeight: 1.3,
        fontVariantNumeric: "tabular-nums",
        color: chartColor("ink"),
        boxShadow: "0 2px 8px rgb(0 0 0 / 0.10)",
        whiteSpace: "nowrap",
        zIndex: 10,
      }}
    >
      {children}
    </div>
  );
}

// Vertical guide line + focus dot drawn inside the chart SVG at the hovered/
// tapped x. Keeps the tap target visually anchored to a real data point.
export function Crosshair({
  x,
  top,
  bottom,
  cy,
  color,
}: {
  x: number;
  top: number;
  bottom: number;
  cy?: number;
  color?: string;
}) {
  return (
    <g pointerEvents="none">
      <line
        x1={x}
        x2={x}
        y1={top}
        y2={bottom}
        stroke={chartColor("faint")}
        strokeWidth={1}
        strokeDasharray="2 2"
      />
      {cy != null && (
        <circle
          cx={x}
          cy={cy}
          r={3.5}
          fill={color ?? chartColor("ink")}
          stroke={chartColor("surface")}
          strokeWidth={2}
        />
      )}
    </g>
  );
}

export { chartColor };
export type { ChartRole };
