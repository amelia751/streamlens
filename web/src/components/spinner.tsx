/**
 * The shadcn / Lucide loader-2 mark: a partial ring that rolls.
 *
 * Not the whole shadcn kit — one SVG, same path, so a connecting screen
 * does not pull a component library in for a spinner.
 */

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={`spinner${className ? ` ${className}` : ""}`}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

export function Connecting({
  label = "Connecting to ClickHouse instance",
}: {
  label?: string;
}) {
  return (
    <div className="connecting" role="status" aria-live="polite">
      <Spinner />
      <p>{label}</p>
    </div>
  );
}
