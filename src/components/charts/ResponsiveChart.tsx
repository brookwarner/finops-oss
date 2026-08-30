"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ChartDims {
  width: number;
  height: number;
  margin: ChartMargin;
  /** Plotting area inside the margins. */
  innerWidth: number;
  innerHeight: number;
}

const ZERO: ChartMargin = { top: 0, right: 0, bottom: 0, left: 0 };

// Client frame that hands charts a real pixel box instead of the old viewBox +
// preserveAspectRatio="none" stretch — so circles stay round and strokes stay
// uniform. The wrapper element owns the height (e.g. `h-36 w-full`); we measure
// it synchronously on mount (getBoundingClientRect in a layout effect, so the
// first paint already has real dims) and track resizes with a ResizeObserver.
// The wrapper is `position: relative` so chart tooltips (absolute) anchor to it.
//
// This replaces @visx/responsive's ParentSize, whose ResizeObserver didn't
// deliver an initial measurement under React 19 (charts rendered at 0×0).
export function ResponsiveChart({
  className,
  margin = ZERO,
  children,
}: {
  className?: string;
  margin?: ChartMargin;
  children: (dims: ChartDims) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { width, height } = size;

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      {width > 0 && height > 0
        ? children({
            width,
            height,
            margin,
            innerWidth: Math.max(0, width - margin.left - margin.right),
            innerHeight: Math.max(0, height - margin.top - margin.bottom),
          })
        : null}
    </div>
  );
}
