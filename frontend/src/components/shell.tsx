import type { IconName, Tone } from "@/lib/theme";
import { TONES } from "@/lib/theme";
import { EnvIcon } from "./icons";
import { SiteNav } from "./nav";

export function Shell({
  title,
  lede,
  kicker,
  tone,
  icon,
  children,
}: {
  title: string;
  lede?: string;
  kicker?: string;
  tone?: Tone;
  icon?: IconName;
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <SiteNav />

      {tone && icon ? (
        <header
          className="puzzle-head"
          style={{ background: TONES[tone] }}
        >
          <EnvIcon name={icon} />
          <h1>{title}</h1>
        </header>
      ) : (
        <header className="masthead">
          {kicker && <p className="kicker">{kicker}</p>}
          <h1>{title}</h1>
        </header>
      )}

      {lede && <p className="lede" style={{ marginBottom: "1.75rem" }}>{lede}</p>}

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
      <p style={{ fontWeight: 700, margin: 0 }}>Backend unreachable.</p>
      <p style={{ margin: "0.35rem 0 0" }}>
        Start it with{" "}
        <code>cd backend &amp;&amp; uv run uvicorn streamlens.api:app --port 8000</code>
      </p>
      <pre>{String(error)}</pre>
    </div>
  );
}
