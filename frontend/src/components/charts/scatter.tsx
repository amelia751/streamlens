"use client";

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { compact } from "@/lib/api";
import { FAINT, INK, LINE, TONES } from "@/lib/theme";

export type ScatterPoint = {
  title: string;
  channels: number;
  rank: number;
  hours: number;
  clips: number;
};

function fillFor(d: ScatterPoint) {
  if (d.channels >= 3 && d.rank > 3) return TONES.yellow;
  if (d.rank === 1) return TONES.green;
  return TONES.blue;
}

export function MismatchScatter({
  points,
  height = 320,
}: {
  points: ScatterPoint[];
  height?: number;
}) {
  if (points.length < 3) {
    return <p className="empty">Not enough titles to plot the mismatch.</p>;
  }

  const worst = Math.max(...points.map((p) => p.rank), 10);

  return (
    <div>
      <div className="chart-frame" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid stroke={LINE} strokeDasharray="3 6" />
            <XAxis
              type="number"
              dataKey="channels"
              name="Channels"
              tickLine={false}
              axisLine={false}
              tick={{ fill: FAINT, fontSize: 11, fontWeight: 600 }}
              label={{
                value: "Promo channels",
                position: "insideBottom",
                offset: -2,
                fill: FAINT,
                fontSize: 11,
              }}
            />
            <YAxis
              type="number"
              dataKey="rank"
              name="Best rank"
              reversed
              domain={[1, worst]}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={36}
              tickFormatter={(v: number) => `#${v}`}
              tick={{ fill: FAINT, fontSize: 11, fontWeight: 600 }}
            />
            <ZAxis type="number" dataKey="hours" range={[40, 280]} />
            <Tooltip
              cursor={{ stroke: INK, strokeDasharray: "3 4" }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as ScatterPoint | undefined;
                if (!active || !p) return null;
                return (
                  <div className="chart-tip">
                    <div className="chart-tip-label">{p.title}</div>
                    <div className="chart-tip-row">
                      <span>Channels</span>
                      <strong>{p.channels}</strong>
                    </div>
                    <div className="chart-tip-row">
                      <span>Best rank</span>
                      <strong>#{p.rank}</strong>
                    </div>
                    <div className="chart-tip-row">
                      <span>Hours</span>
                      <strong>{compact(p.hours)}</strong>
                    </div>
                    <div className="chart-tip-row">
                      <span>Clips</span>
                      <strong>{p.clips}</strong>
                    </div>
                  </div>
                );
              }}
            />
            <Scatter
              data={points}
              animationDuration={800}
              shape={(props) => {
                const { cx, cy, size, payload } = props;
                if (cx == null || cy == null) return <g />;
                const r = Math.max(4, Math.sqrt((size ?? 80) / Math.PI));
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={fillFor(payload as ScatterPoint)}
                    fillOpacity={0.88}
                    stroke={INK}
                    strokeWidth={0.8}
                  />
                );
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="legend">
        <span>
          <i style={{ background: TONES.yellow }} /> Heavy push, weak chart
        </span>
        <span>
          <i style={{ background: TONES.green }} /> Reached #1
        </span>
        <span>
          <i style={{ background: TONES.blue }} /> The rest
        </span>
      </div>
    </div>
  );
}
