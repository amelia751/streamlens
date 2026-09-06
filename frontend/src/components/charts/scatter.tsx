"use client";

import {
  CartesianGrid,
  Cell,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { compact } from "@/lib/api";
import { INK, LINE, TONES } from "@/lib/theme";
import { AXIS_TICK, ChartFrame } from "./frame";

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

function rankTicks(worst: number) {
  const top = Math.max(worst, 4);
  const step = top <= 6 ? 1 : top <= 12 ? 3 : 5;
  const ticks = [1];
  for (let n = 1 + step; n < top; n += step) ticks.push(n);
  if (ticks[ticks.length - 1] !== top) ticks.push(top);
  return ticks;
}

export function MismatchScatter({
  points,
  height = 340,
}: {
  points: ScatterPoint[];
  height?: number;
}) {
  const rows = points.filter(
    (p) =>
      Number.isFinite(p.channels) &&
      Number.isFinite(p.rank) &&
      p.channels >= 0 &&
      p.rank >= 1,
  );

  if (rows.length < 3) {
    return <p className="empty">Not enough titles to plot the mismatch.</p>;
  }

  const worst = Math.max(...rows.map((p) => p.rank), 4);
  const maxCh = Math.max(...rows.map((p) => p.channels), 4);

  return (
    <div>
      <ChartFrame height={height}>
        {({ width, height: h }) => (
          <ScatterChart
            width={width}
            height={h}
            margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
          >
            <CartesianGrid stroke={LINE} strokeDasharray="3 6" />
            <XAxis
              type="number"
              dataKey="channels"
              name="Channels"
              domain={[0, Math.ceil(maxCh / 4) * 4 || 4]}
              tickCount={5}
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
            />
            <YAxis
              type="number"
              dataKey="rank"
              name="Best rank"
              reversed
              domain={[1, worst]}
              ticks={rankTicks(worst)}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={36}
              tickFormatter={(v: number) => `#${v}`}
              tick={AXIS_TICK}
            />
            <ZAxis type="number" dataKey="hours" range={[70, 360]} />
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
            <Scatter data={rows} animationDuration={700}>
              {rows.map((p, i) => (
                <Cell
                  key={`${p.title}-${i}`}
                  fill={fillFor(p)}
                  stroke={INK}
                  strokeWidth={0.6}
                />
              ))}
            </Scatter>
          </ScatterChart>
        )}
      </ChartFrame>
      <p className="chart-axis-note">Horizontal: promo channels · Vertical: best global rank · Area: hours viewed</p>
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
