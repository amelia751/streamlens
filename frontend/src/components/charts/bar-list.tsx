"use client";

import { motion, useReducedMotion } from "motion/react";
import { compact, commas, num } from "@/lib/api";
import type { Tone } from "@/lib/theme";
import { TONES } from "@/lib/theme";
import { TitleLink } from "@/components/title-link";

const ease = [0.22, 1, 0.36, 1] as const;

const FORMATS = {
  compact,
  commas,
  raw: (v: unknown) => String(num(v)),
  channels: (v: unknown) => `${num(v)} ch`,
} as const;

export type BarFormat = keyof typeof FORMATS;

export function BarList({
  data,
  format = "compact",
  emptyLabel = "No data yet.",
  tone = "yellow",
}: {
  data: { label: string; value: number; note?: string; dossier?: boolean }[];
  format?: BarFormat;
  emptyLabel?: string;
  tone?: Tone;
}) {
  const reduce = useReducedMotion();
  if (!data.length) return <p className="empty">{emptyLabel}</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  const fill = TONES[tone];
  const valueFormat = FORMATS[format];

  return (
    <ul className="space-y-0.5">
      {data.map((d, i) => {
        const pct = Math.max((d.value / max) * 100, 2);
        return (
          <li key={d.label} className="bar-row">
            <div className="bar-track" aria-hidden />
            <motion.div
              className="bar-fill"
              aria-hidden
              style={{ background: fill }}
              initial={reduce ? false : { width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.7, delay: i * 0.04, ease }}
            />
            <span className="bar-label">
              {d.dossier ? <TitleLink title={d.label} /> : d.label}
            </span>
            {d.note && <span className="bar-note">{d.note}</span>}
            <span className="bar-value">{valueFormat(d.value)}</span>
          </li>
        );
      })}
    </ul>
  );
}
