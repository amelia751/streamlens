export default function Loading() {
  return (
    <div className="shell">
      <div className="site-nav">
        <span className="wordmark">Streamlens</span>
      </div>
      <div className="h-20 animate-pulse rounded-xl bg-wash" />
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-wash" />
        ))}
      </div>
    </div>
  );
}
