"use client";

type TipItem = {
  name?: string | number;
  value?: unknown;
  color?: string;
};

export function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TipItem[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      {label !== undefined && label !== "" && (
        <div className="chart-tip-label">{String(label)}</div>
      )}
      {payload.map((p, i) => (
        <div className="chart-tip-row" key={`${p.name}-${i}`}>
          <span>{p.name}</span>
          <strong>{String(p.value ?? "")}</strong>
        </div>
      ))}
    </div>
  );
}
