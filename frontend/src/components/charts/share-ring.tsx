"use client";

import { Cell, Pie, PieChart, Tooltip } from "recharts";
import { TONES } from "@/lib/theme";
import { ChartTooltip } from "./tooltip";

export function ShareRing({
  shorts,
  longForm,
  size = 148,
}: {
  shorts: number;
  longForm: number;
  size?: number;
}) {
  const total = shorts + longForm;
  if (total <= 0) return <p className="empty">No cadence yet.</p>;
  const rows = [
    { name: "Shorts", value: shorts },
    { name: "Long form", value: longForm },
  ];
  const pct = Math.round((shorts / total) * 100);

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <PieChart width={size} height={size}>
          <Tooltip content={<ChartTooltip />} />
          <Pie
            data={rows}
            dataKey="value"
            nameKey="name"
            innerRadius="64%"
            outerRadius="92%"
            paddingAngle={2}
            stroke="none"
            animationDuration={800}
          >
            <Cell fill={TONES.yellow} />
            <Cell fill={TONES.blue} />
          </Pie>
        </PieChart>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold leading-none tracking-tight tabular-nums">
          {pct}%
        </span>
        <span className="mt-1 text-[11px] font-medium text-muted">Shorts</span>
      </div>
    </div>
  );
}
