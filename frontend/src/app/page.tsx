import Link from "next/link";
import { Shell, ErrorNote } from "@/components/shell";
import { Stat } from "@/components/charts";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { runQuery, compact, commas } from "@/lib/api";
import { TONES, type Tone } from "@/lib/theme";

export const dynamic = "force-dynamic";

const DASHBOARDS: {
  href: string;
  name: string;
  blurb: string;
  tone: Tone;
}[] = [
  {
    href: "/dashboards/greenlight",
    name: "Greenlight",
    blurb:
      "Promotional push against Top 10 outcome, title by title. Where the marketing spend and the result disagree.",
    tone: "yellow",
  },
  {
    href: "/dashboards/rollout",
    name: "Rollout",
    blurb:
      "The Weekly Top 10 across 94 countries and five years. Which titles travel, and which stay home.",
    tone: "blue",
  },
  {
    href: "/dashboards/promo",
    name: "Promo",
    blurb:
      "44 Netflix YouTube channels as one publishing operation. Cadence, format mix, and market coverage.",
    tone: "green",
  },
];

export default async function Home() {
  let o: Record<string, unknown> = {};
  try {
    o = (await runQuery("overview")).rows[0] ?? {};
  } catch (error) {
    return (
      <Shell title="Overview" kicker="Streamlens">
        <ErrorNote error={error} />
      </Shell>
    );
  }

  return (
    <Shell
      title="What a studio promotes, against what actually performs"
      kicker="Overview"
      lede="A studio-side view assembled from public sources into ClickHouse Cloud and read by a Gemini agent on Google Cloud."
    >
      <Stagger className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StaggerItem>
          <Stat
            label="YouTube channels"
            value={commas(o.channels)}
            hint="Netflix-operated, verified"
            index={0}
          />
        </StaggerItem>
        <StaggerItem>
          <Stat
            label="Videos"
            value={compact(o.videos)}
            hint={`${compact(o.snapshots)} stat snapshots`}
            index={1}
          />
        </StaggerItem>
        <StaggerItem>
          <Stat
            label="Top 10 titles"
            value={commas(o.top10_titles)}
            hint={`${commas(o.countries)} countries`}
            index={2}
          />
        </StaggerItem>
        <StaggerItem>
          <Stat
            label="Linked titles"
            value={commas(o.linked_titles)}
            hint="promo ↔ chart"
            index={3}
          />
        </StaggerItem>
      </Stagger>

      <p className="kicker">Dashboards</p>
      <Reveal delay={0.1}>
        <div className="grid gap-3 md:grid-cols-3">
          {DASHBOARDS.map((d) => (
            <Link key={d.href} href={d.href} className="dest-card">
              <span
                className="tone-bar"
                style={{ background: TONES[d.tone] }}
              />
              <h2>{d.name}</h2>
              <p>{d.blurb}</p>
              <span className="go">Open →</span>
            </Link>
          ))}
        </div>
      </Reveal>
    </Shell>
  );
}
