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

/** A whole screen, or a whole panel of one, that has nothing to draw yet. */
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

/**
 * The same mark at text size, for a tile too short to centre a screen in.
 *
 * `overlay` covers the tile's chart box instead of taking room beside it,
 * which is what a chart waiting on its geometry needs: the box has to stay
 * laid out, because ECharts is already initialised against it.
 */
export function Waiting({
  label,
  overlay = false,
}: {
  label: string;
  overlay?: boolean;
}) {
  return (
    <p
      className={`tile-waiting${overlay ? " is-overlay" : ""}`}
      role="status"
      aria-live="polite"
    >
      <Spinner className="spinner-sm" />
      {label}
    </p>
  );
}
