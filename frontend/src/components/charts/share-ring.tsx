"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
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
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
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
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-serif text-2xl font-bold leading-none tracking-tight"
          style={{ fontFamily: "var(--font-cheltenham), Georgia, serif" }}
        >
          {pct}%
        </span>
        <span className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
          Shorts
        </span>
      </div>
    </div>
  );
}
