"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Cell,
  ReferenceLine,
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
  weeks: number;
};

/**
 * Promotional push against audience outcome.
 *
 * Best rank is deliberately *not* an axis here. It is a Top 10 chart, so rank
 * only takes ten values and roughly two thirds of linked titles reached #1 —
 * plotting it vertically stacks most of the catalogue on a single line and
 * hides points underneath each other at identical integer coordinates. Hours
 * viewed spans four orders of magnitude, so it carries the outcome on a log
 * axis and rank moves to colour, where six categories are plenty.
 */
function fillFor(d: ScatterPoint) {
  if (d.rank === 1) return TONES.green;
  if (d.rank <= 3) return TONES.blue;
  return TONES.yellow;
}

/**
 * Stable per-title offset in roughly ±0.32 of a channel.
 *
 * Channel count is a small integer and most titles carry one or two, so
 * without this several hundred points land on the same vertical line and
 * read as a solid bar. Derived from the title rather than random so a point
 * does not jump between renders; the tooltip always reports the true value.
 */
function jitter(title: string) {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) | 0;
  return ((h % 1000) / 1000 - 0.5) * 0.64;
}

function logTicks(min: number, max: number) {
  const ticks: number[] = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    ticks.push(10 ** e);
  }
  return ticks;
}

export function MismatchScatter({
  points,
  height = 260,
  onSelectTitle,
}: {
  points: ScatterPoint[];
  height?: number;
  onSelectTitle?: (title: string) => void;
}) {

  const rows = useMemo(
    () =>
      points
        .filter(
          (p) =>
            Number.isFinite(p.channels) &&
            Number.isFinite(p.hours) &&
            p.channels >= 0 &&
            // A log axis cannot render zero, and a title with no published
            // hours has no outcome to compare the push against anyway.
            p.hours > 0,
        )
        .map((p) => ({ ...p, plotX: p.channels + jitter(p.title) })),
    [points],
  );

  const stats = useMemo(() => {
    if (!rows.length) return null;
    const hours = rows.map((p) => p.hours).sort((a, b) => a - b);
    const maxCh = Math.max(...rows.map((p) => p.channels), 4);
    const step = Math.max(1, Math.ceil(maxCh / 4));
    const axisMax = Math.ceil(maxCh / step) * step;
    const xTicks: number[] = [];
    for (let n = 0; n <= axisMax; n += step) xTicks.push(n);
    return {
      minH: hours[0],
      maxH: hours[hours.length - 1],
      median: hours[Math.floor(hours.length / 2)],
      maxCh,
      axisMax,
      xTicks,
    };
  }, [rows]);

  if (!stats || rows.length < 3) {
    return <p className="empty">Not enough titles to plot the mismatch.</p>;
  }

  return (
    <div>
      <ChartFrame height={height}>
        {({ width, height: h }) => (
          <ScatterChart
            width={width}
            height={h}
            margin={{ top: 10, right: 16, left: 8, bottom: 4 }}
          >
            <CartesianGrid stroke={LINE} strokeDasharray="3 6" />
            <XAxis
              type="number"
              dataKey="plotX"
              name="Channels"
              // The domain is padded to hold the jitter, but the ticks stay on
              // whole channels — a "-0.6 channels" gridline is nonsense.
              domain={[-0.7, stats.axisMax + 0.7]}
              ticks={stats.xTicks}
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
            />
            <YAxis
              type="number"
              dataKey="hours"
              name="Hours viewed"
              scale="log"
              domain={[stats.minH * 0.8, stats.maxH * 1.2]}
              ticks={logTicks(stats.minH, stats.maxH)}
              tickLine={false}
              axisLine={false}
              width={46}
              tickFormatter={(v: number) => compact(v)}
              tick={AXIS_TICK}
            />
            <ZAxis type="number" dataKey="weeks" range={[40, 420]} name="Weeks" />
            <ReferenceLine
              y={stats.median}
              stroke={INK}
              strokeDasharray="4 5"
              strokeOpacity={0.45}
              label={{
                value: `median ${compact(stats.median)} h`,
                position: "insideTopRight",
                fontSize: 10,
                fill: "#8a8a8a",
              }}
            />
            <Tooltip
              cursor={{ stroke: INK, strokeDasharray: "3 4", strokeOpacity: 0.4 }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as ScatterPoint | undefined;
                if (!active || !p) return null;
                return (
                  <div className="chart-tip">
                    <div className="chart-tip-label">{p.title}</div>
                    <div className="chart-tip-row">
                      <span>Hours viewed</span>
                      <strong>{compact(p.hours)}</strong>
                    </div>
                    <div className="chart-tip-row">
                      <span>Promo channels</span>
                      <strong>{p.channels}</strong>
                    </div>
                    <div className="chart-tip-row">
                      <span>Clips</span>
                      <strong>{p.clips}</strong>
                    </div>
                    <div className="chart-tip-row">
                      <span>Best rank</span>
                      <strong>#{p.rank}</strong>
                    </div>
                    <div className="chart-tip-row">
                      <span>Weeks charted</span>
                      <strong>{p.weeks}</strong>
                    </div>
                  </div>
                );
              }}
            />
            <Scatter
              data={rows}
              animationDuration={600}
              onClick={(d: unknown) => {
                const p = (d as { payload?: ScatterPoint })?.payload;
                if (p) onSelectTitle?.(p.title);
              }}
            >
              {rows.map((p, i) => (
                <Cell
                  key={`${p.title}-${i}`}
                  fill={fillFor(p)}
                  fillOpacity={0.75}
                  stroke={INK}
                  strokeOpacity={0.55}
                  strokeWidth={0.6}
                  cursor="pointer"
                />
              ))}
            </Scatter>
          </ScatterChart>
        )}
      </ChartFrame>
      <p className="chart-axis-note">
        Right is more channels. Up is hours viewed. Size is weeks on the chart.
      </p>
      <div className="legend">
        <span>
          <i style={{ background: TONES.green }} /> Reached #1
        </span>
        <span>
          <i style={{ background: TONES.blue }} /> Top 3
        </span>
        <span>
          <i style={{ background: TONES.yellow }} /> Never broke top 3
        </span>
      </div>
    </div>
  );
}
