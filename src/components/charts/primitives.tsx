import { LinearGradient } from "@visx/gradient";
import { chartColor, type ChartRole } from "./theme";

// Horizontal dashed reference line (target / average / zero baseline) with an
// optional label anchored to the left or right edge. Pure SVG.
export function ReferenceLine({
  y,
  x1,
  x2,
  role = "faint",
  dash = "2 2",
  width = 1,
  label,
  labelSide = "right",
  labelRole,
}: {
  y: number;
  x1: number;
  x2: number;
  role?: ChartRole;
  dash?: string;
  width?: number;
  label?: string;
  labelSide?: "left" | "right";
  labelRole?: ChartRole;
}) {
  return (
    <g pointerEvents="none">
      <line
        x1={x1}
        x2={x2}
        y1={y}
        y2={y}
        stroke={chartColor(role)}
        strokeWidth={width}
        strokeDasharray={dash}
      />
      {label != null && (
        <text
          x={labelSide === "right" ? x2 : x1}
          y={y - 3}
          textAnchor={labelSide === "right" ? "end" : "start"}
          fontSize={9}
          fill={chartColor(labelRole ?? role)}
        >
          {label}
        </text>
      )}
    </g>
  );
}

// Vertical area-fill gradient: a token colour fading from `from` opacity at the
// top to `to` opacity at the bottom. Referenced by an AreaClosed via `url(#id)`.
export function AreaGradient({
  id,
  role,
  from = 0.22,
  to = 0,
}: {
  id: string;
  role: ChartRole;
  from?: number;
  to?: number;
}) {
  return (
    <LinearGradient
      id={id}
      from={chartColor(role)}
      to={chartColor(role)}
      fromOpacity={from}
      toOpacity={to}
      vertical
    />
  );
}
