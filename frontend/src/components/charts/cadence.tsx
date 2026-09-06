"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { commas } from "@/lib/api";
import { INK, LINE, TONES } from "@/lib/theme";
import { AXIS_TICK, ChartFrame } from "./frame";
import { ChartTooltip } from "./tooltip";

function monthLabel(raw: string) {
  const [y, m] = raw.split("-");
  if (!y || !m) return raw;
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${names[Number(m) - 1] ?? m} ${y.slice(2)}`;
}

export function StackedBars({
  data,
  height = 240,
}: {
  data: { label: string; a: number; b: number }[];
  height?: number;
}) {
  const uid = useId().replace(/:/g, "");
  if (!data.length) return <p className="empty">No data.</p>;

  const rows = data.map((d) => ({
    label: monthLabel(d.label),
    Shorts: d.a,
    "Long form": d.b,
  }));

  const tickEvery = Math.max(1, Math.floor(rows.length / 7));

  return (
    <div>
      <ChartFrame height={height}>
        {({ width, height: h }) => (
          <AreaChart
            width={width}
            height={h}
            data={rows}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id={`${uid}-shorts`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={TONES.yellow} stopOpacity={0.95} />
                <stop offset="100%" stopColor={TONES.yellow} stopOpacity={0.2} />
              </linearGradient>
              <linearGradient id={`${uid}-long`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={TONES.blue} stopOpacity={0.9} />
                <stop offset="100%" stopColor={TONES.blue} stopOpacity={0.18} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={LINE} strokeDasharray="3 6" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval={tickEvery}
              tick={AXIS_TICK}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={44}
              tick={AXIS_TICK}
              tickFormatter={(v: number) => commas(v)}
            />
            <Tooltip
              cursor={{ stroke: INK, strokeWidth: 1, strokeDasharray: "3 4" }}
              content={<ChartTooltip />}
            />
            <Area
              type="monotone"
              dataKey="Shorts"
              stackId="1"
              stroke="#c9a62a"
              strokeWidth={1.6}
              fill={`url(#${uid}-shorts)`}
              animationDuration={900}
              animationEasing="ease-out"
            />
            <Area
              type="monotone"
              dataKey="Long form"
              stackId="1"
              stroke="#6e86c4"
              strokeWidth={1.6}
              fill={`url(#${uid}-long)`}
              animationDuration={900}
              animationEasing="ease-out"
            />
          </AreaChart>
        )}
      </ChartFrame>
      <div className="legend">
        <span>
          <i style={{ background: TONES.yellow }} /> Shorts
        </span>
        <span>
          <i style={{ background: TONES.blue }} /> Long form
        </span>
      </div>
    </div>
  );
}
