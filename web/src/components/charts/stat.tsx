export function Stats({ children }: { children: React.ReactNode }) {
  return <dl className="stats">{children}</dl>;
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="stat">
      <dt className="stat-label">
        {label}
        {hint ? <span className="stat-hint">{hint}</span> : null}
      </dt>
      <dd className="stat-value">{value}</dd>
    </div>
  );
}
