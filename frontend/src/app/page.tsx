import Link from "next/link";
import { Shell, ErrorNote } from "@/components/shell";
import { Stat } from "@/components/charts";
import { EnvIcon } from "@/components/icons";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { runQuery, compact, commas } from "@/lib/api";
import { TONES, type IconName, type Tone } from "@/lib/theme";

export const dynamic = "force-dynamic";

const DASHBOARDS: {
  href: string;
  name: string;
  blurb: string;
  tone: Tone;
  icon: IconName;
}[] = [
  {
    href: "/dashboards/greenlight",
    name: "The Greenlight Room",
    blurb:
      "Promotional push against Top 10 outcome, title by title. Where the marketing spend and the result disagree.",
    tone: "yellow",
    icon: "star",
  },
  {
    href: "/dashboards/rollout",
    name: "The Global Rollout",
    blurb:
      "The Weekly Top 10 across 94 countries and five years. Which titles travel, and which stay home.",
    tone: "blue",
    icon: "diamond",
  },
  {
    href: "/dashboards/promo",
    name: "The Promo Machine",
    blurb:
      "44 Netflix YouTube channels as one publishing operation. Cadence, format mix, and market coverage.",
    tone: "green",
    icon: "tiles",
  },
];

export default async function Home() {
  let o: Record<string, unknown> = {};
  try {
    o = (await runQuery("overview")).rows[0] ?? {};
  } catch (error) {
    return (
      <Shell
        title="What a studio promotes, against what actually performs."
        kicker="The desk"
      >
        <ErrorNote error={error} />
      </Shell>
    );
  }

  return (
    <Shell
      title="What a studio promotes, against what actually performs."
      kicker="The desk"
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

      <p className="kicker">The rooms</p>
      <Reveal delay={0.15}>
        <div className="grid gap-4 md:grid-cols-3">
          {DASHBOARDS.map((d) => (
            <Link key={d.href} href={d.href} className="game-card">
              <div
                className="game-card-top"
                style={{ background: TONES[d.tone] }}
              >
                <EnvIcon name={d.icon} />
                <h2>{d.name}</h2>
              </div>
              <div className="game-card-body">
                <p>{d.blurb}</p>
                <div className="card-actions">
                  <span className="pill">Open</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </Reveal>
    </Shell>
  );
}
