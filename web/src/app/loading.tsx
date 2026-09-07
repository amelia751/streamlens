export default function Loading() {
  return (
    <div className="shell">
      <div className="page-head">
        <div className="h-7 w-48 animate-pulse rounded bg-wash" />
        <div className="mt-3 h-4 w-80 max-w-full animate-pulse rounded bg-wash" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="stat h-24 animate-pulse" />
        ))}
      </div>
    </div>
  );
}
