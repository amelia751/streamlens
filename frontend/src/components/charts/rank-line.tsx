"use client";

import { useId } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { compact } from "@/lib/api";
import { FAINT, INK, LINE, TONES } from "@/lib/theme";

export function RankLine({
  points,
  height = 260,
}: {
  points: { week: string; rank: number; hours: number }[];
  height?: number;
}) {
  const uid = useId().replace(/:/g, "");
  if (points.length < 2) {
    return (
      <p className="empty">Not enough weeks charted to draw a trajectory.</p>
    );
  }

  const worst = Math.max(...points.map((p) => p.rank), 10);
  const rows = points.map((p) => ({
    ...p,
    label: p.week.slice(0, 10),
  }));

  return (
    <div className="chart-frame" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={TONES.purple} stopOpacity={0.35} />
              <stop offset="100%" stopColor={TONES.purple} stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={LINE} strokeDasharray="3 6" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={48}
            tick={{ fill: FAINT, fontSize: 11, fontWeight: 600 }}
          />
          <YAxis
            dataKey="rank"
            reversed
            domain={[1, worst]}
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            width={36}
            tickFormatter={(v: number) => `#${v}`}
            tick={{ fill: FAINT, fontSize: 11, fontWeight: 600 }}
          />
          <Tooltip
            cursor={{ stroke: INK, strokeWidth: 1, strokeDasharray: "3 4" }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as
                | { week: string; rank: number; hours: number }
                | undefined;
              if (!active || !p) return null;
              return (
                <div className="chart-tip">
                  <div className="chart-tip-label">{p.week.slice(0, 10)}</div>
                  <div className="chart-tip-row">
                    <span>Rank</span>
                    <strong>#{p.rank}</strong>
                  </div>
                  <div className="chart-tip-row">
                    <span>Hours</span>
                    <strong>{compact(p.hours)}</strong>
                  </div>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="rank"
            stroke="none"
            fill={`url(#${uid}-area)`}
            animationDuration={900}
          />
          <Line
            type="monotone"
            dataKey="rank"
            stroke={INK}
            strokeWidth={2.2}
            dot={(props) => {
              const { cx, cy, payload, index } = props;
              if (cx == null || cy == null) return <g key={index} />;
              const first = payload.rank === 1;
              return (
                <circle
                  key={index}
                  cx={cx}
                  cy={cy}
                  r={first ? 5 : 3.2}
                  fill={first ? TONES.yellow : INK}
                  stroke={INK}
                  strokeWidth={first ? 1.4 : 0}
                />
              );
            }}
            activeDot={{ r: 6, fill: TONES.yellow, stroke: INK, strokeWidth: 1.5 }}
            animationDuration={1000}
            animationEasing="ease-out"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
