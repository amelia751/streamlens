import type { Tone } from "@/lib/theme";
import { TONES } from "@/lib/theme";

const CYCLE: Tone[] = ["yellow", "green", "blue", "purple", "teal"];

export function Stat({
  label,
  value,
  hint,
  tone,
  index = 0,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
  index?: number;
}) {
  const color = TONES[tone ?? CYCLE[index % CYCLE.length]];
  return (
    <div className="stat" style={{ "--stat-tone": color } as React.CSSProperties}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}
