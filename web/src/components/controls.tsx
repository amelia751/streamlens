"use client";

/**
 * Filter controls for the dashboards.
 *
 * Styled from the theme's CSS custom properties rather than from classes in
 * globals.css. The visual language of the app is being reworked in parallel,
 * and reading the tokens means these follow that work instead of pinning a
 * second, competing set of colours next to it.
 */
import { AnimatePresence, motion } from "motion/react";
import { TONES, type Tone } from "@/lib/theme";

const BASE: React.CSSProperties = {
  height: "1.75rem",
  border: "1px solid var(--line)",
  borderRadius: 6,
  background: "var(--paper)",
  color: "var(--ink)",
  fontSize: "0.75rem",
  fontWeight: 500,
  fontFamily: "inherit",
};

export function ControlBar({
  children,
  resultLabel,
  onReset,
  dirty,
}: {
  children: React.ReactNode;
  resultLabel?: string;
  onReset?: () => void;
  dirty?: boolean;
}) {
  return (
    <div className="control-bar">
      {children}
      <div className="control-bar-meta">
        {resultLabel && <span className="control-count">{resultLabel}</span>}
        <AnimatePresence>
          {dirty && onReset && (
            <motion.button
              type="button"
              onClick={onReset}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.14 }}
              className="control-reset"
            >
              Reset
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="control-label">{children}</span>;
}

export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-2.5 pr-7"
        style={{
          ...BASE,
          appearance: "none",
          cursor: "pointer",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%235c5c5c' d='M1 1l5 5 5-5'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 0.6rem center",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SearchInput({
  label,
  value,
  onChange,
  placeholder,
  width = "13rem",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: string;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <div className="relative" style={{ width }}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-2.5 pr-7"
          style={BASE}
        />
        <AnimatePresence>
          {value && (
            <motion.button
              type="button"
              aria-label="Clear search"
              onClick={() => onChange("")}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute right-2 top-1/2 -translate-y-1/2 leading-none"
              style={{
                color: "var(--faint)",
                fontSize: "0.9rem",
                cursor: "pointer",
              }}
            >
              ×
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </label>
  );
}

/** Mutually exclusive options rendered inline, for short option sets. */
export function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; tone?: Tone }[];
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div
        className="flex overflow-hidden rounded-lg"
        style={{ border: "1px solid var(--line)", background: "var(--paper)" }}
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className="relative px-2 py-1"
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: on ? "var(--ink)" : "var(--muted)",
                cursor: "pointer",
              }}
            >
              {on && (
                <motion.span
                  layoutId={`seg-${label}`}
                  className="absolute inset-0"
                  style={{
                    background: o.tone
                      ? `color-mix(in srgb, ${TONES[o.tone]} 58%, white)`
                      : "var(--wash)",
                  }}
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <span className="relative">{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RangeSlider({
  label,
  value,
  min,
  max,
  onChange,
  suffix = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <label className="block">
      <Label>
        {label}
        <span
          className="ml-1 tabular-nums"
          style={{ color: "var(--ink)", fontWeight: 700 }}
        >
          {value}
          {suffix}
        </span>
      </Label>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-7 w-28 cursor-pointer"
        style={{ accentColor: "var(--yellow)" }}
      />
    </label>
  );
}
