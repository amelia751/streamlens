import type { Tone } from "@/lib/theme";
import { TONES } from "@/lib/theme";

export function Shell({
  title,
  lede,
  kicker,
  tone,
  children,
}: {
  title: string;
  lede?: string;
  kicker?: string;
  tone?: Tone;
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <header className="page-head">
        {kicker && (
          <p className="kicker">
            {tone && (
              <i className="tone-dot" style={{ background: TONES[tone] }} />
            )}
            {kicker}
          </p>
        )}
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </header>

      {children}

      <footer className="site-foot">
        Publicly observed and reconstructed data. Not Netflix ground truth.
        Netflix Top 10 and engagement figures are published by Netflix; YouTube
        statistics come from the YouTube Data API and are retained for 30 days
        under the YouTube API Developer Policies. Ratios and per-clip figures
        are computed by Streamlens and are not YouTube or Netflix metrics.
      </footer>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  return (
    <div className="note">
      <p style={{ fontWeight: 600, margin: 0 }}>Backend unreachable.</p>
      <p style={{ margin: "0.35rem 0 0" }}>
        Start it with{" "}
        <code>
          cd backend &amp;&amp; uv run uvicorn streamlens.api:app --port 8000
        </code>
      </p>
      <pre>{String(error)}</pre>
    </div>
  );
}
