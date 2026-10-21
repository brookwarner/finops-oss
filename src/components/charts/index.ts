// Shared chart foundation. Every chart sits on these primitives so tooltips,
// crosshairs, reference lines, sizing, and theming stay consistent app-wide.
export { ResponsiveChart } from "./ResponsiveChart";
export type { ChartDims, ChartMargin } from "./ResponsiveChart";
export { useChartTooltip } from "./useChartTooltip";
export { ChartTooltip, Crosshair } from "./ChartTooltip";
export { ReferenceLine, AreaGradient } from "./primitives";
export { chartColor, ragRole, incomeRole } from "./theme";
export type { ChartRole } from "./theme";
