"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Measure the plot box and pass a real pixel size into Recharts.
 * ResponsiveContainer often reports 0×0 inside motion/grid parents, which
 * dumps axis ticks as a vertical text list and hides every mark.
 */
export function ChartFrame({
  height = 280,
  children,
}: {
  height?: number;
  children: (size: { width: number; height: number }) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="chart-frame" style={{ height, width: "100%" }}>
      {width >= 160 ? children({ width, height }) : null}
    </div>
  );
}

export const AXIS_TICK = {
  fill: "#8a8a8a",
  fontSize: 11,
  fontWeight: 500,
  fontFamily: "var(--font-sans), Inter, sans-serif",
} as const;
