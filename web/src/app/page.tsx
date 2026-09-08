import Link from "next/link";
import { Shell, ErrorNote } from "@/components/shell";
import { Stat, Stats } from "@/components/charts";
import { Reveal } from "@/components/motion";
import { runQuery, compact, commas } from "@/lib/api";
import type { Tone } from "@/lib/theme";

export const dynamic = "force-dynamic";

const ROOMS: {
  href: string;
  name: string;
  blurb: string;
  tone: Tone;
}[] = [
  {
    href: "/data?view=titles",
    name: "By Title Performance",
    blurb:
      "YouTube promo against Weekly Top 10 results, and where each title landed country by country.",
    tone: "yellow",
  },
  {
    href: "/data?view=promo",
    name: "By Youtube Campaigns",
    blurb: "What the 44 Netflix YouTube channels publish, where, and in what format.",
    tone: "green",
  },
  {
    href: "/studio",
    name: "Studio",
    blurb:
      "The warehouse, and what you build from it.",
    tone: "purple",
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
      lede="Two cuts of the public warehouse on one desk, and a studio that builds more."
    >
      <Stats>
        <Stat
          label="YouTube channels"
          value={commas(o.channels)}
          hint="Netflix-operated, verified"
        />
        <Stat
          label="Videos"
          value={compact(o.videos)}
          hint={`${compact(o.snapshots)} snapshots`}
        />
        <Stat
          label="Top 10 titles"
          value={commas(o.top10_titles)}
          hint={`${commas(o.countries)} countries`}
        />
        <Stat
          label="Linked titles"
          value={commas(o.linked_titles)}
          hint="promo ↔ chart"
        />
      </Stats>

      <p className="kicker">Rooms</p>
      <Reveal delay={0.1}>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {ROOMS.map((d) => (
            <Link key={d.href} href={d.href} className="dest-card">
              <i className={`swatch tone-${d.tone}`} aria-hidden />
              <h2>{d.name}</h2>
              <p>{d.blurb}</p>
            </Link>
          ))}
        </div>
      </Reveal>
    </Shell>
  );
}
