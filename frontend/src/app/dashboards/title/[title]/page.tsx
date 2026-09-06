import Link from "next/link";
import { Shell, ErrorNote } from "@/components/shell";
import { Panel, Stat, Stats, DataTable, BarList, RankLine } from "@/components/charts";
import { GreenlightBrief } from "@/components/brief";
import { Reveal } from "@/components/motion";
import { runQuery, compact, commas, num, str } from "@/lib/api";
import { ROOMS } from "@/lib/theme";

export const dynamic = "force-dynamic";

export default async function TitleDossier({
  params,
}: {
  params: Promise<{ title: string }>;
}) {
  const { title: raw } = await params;
  const title = decodeURIComponent(raw);

  let trajectory: Record<string, unknown>[] = [];
  let footprint: Record<string, unknown>[] = [];
  let clips: Record<string, unknown>[] = [];
  let mix: Record<string, unknown>[] = [];
  let reception: Record<string, unknown>[] = [];
  try {
    const [t, f, c, m, r] = await Promise.all([
      runQuery("rollout_global_trajectory", { title }),
      runQuery("rollout_title_footprint", { title }),
      runQuery("dossier_clips", { title, limit: 40 }),
      runQuery("greenlight_channel_mix", { title }),
      runQuery("dossier_reception", { title }),
    ]);
    trajectory = t.rows;
    footprint = f.rows;
    clips = c.rows;
    mix = m.rows;
    reception = r.rows;
  } catch (error) {
    return (
      <Shell title={title} {...ROOMS.title}>
        <ErrorNote error={error} />
      </Shell>
    );
  }

  const bestRank = Math.min(...trajectory.map((r) => num(r.rank)), 99);
  const hours = trajectory.reduce((s, r) => s + num(r.hours_viewed), 0);
  const imdb = reception[0];

  return (
    <Shell
      title={title}
      lede="One title across every source Streamlens holds: the promotional push on YouTube, the Weekly Top 10 outcome globally and by country, and public reception."
      {...ROOMS.title}
    >
      <p className="mb-5">
        <Link
          href="/dashboards/greenlight"
          className="title-link text-[0.72rem] font-bold uppercase tracking-[0.08em] text-muted hover:text-ink"
        >
          ← Greenlight Room
        </Link>
      </p>

      <Stats>
        <Stat
          label="Best global rank"
          value={bestRank < 99 ? `#${bestRank}` : "—"}
        />
        <Stat label="Weeks charted" value={commas(trajectory.length)} />
        <Stat label="Hours viewed" value={compact(hours)} />
        <Stat label="Countries" value={commas(footprint.length)} />
        <Stat
          label="IMDb"
          value={imdb ? `${num(imdb.average_rating).toFixed(1)}` : "—"}
          hint={imdb ? `${compact(imdb.num_votes)} votes` : "no exact title match"}
        />
      </Stats>

      <Reveal className="mb-6">
        <GreenlightBrief title={title} />
      </Reveal>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Reveal className="lg:col-span-2">
          <Panel
            title="Global rank trajectory"
            subtitle="Weekly position in the global Top 10. Higher on the chart is a better rank. Yellow marks a week at #1."
          >
            <RankLine
              points={trajectory.map((r) => ({
                week: str(r.week),
                rank: num(r.rank),
                hours: num(r.hours_viewed),
              }))}
            />
          </Panel>
        </Reveal>

        <Reveal delay={0.08}>
          <Panel
            title="Promo footprint"
            subtitle="Which Netflix channels carried this title."
          >
            <BarList
              tone="purple"
              data={mix.slice(0, 12).map((r) => ({
                label: str(r.channel),
                value: num(r.clips),
                note: str(r.market),
              }))}
              format="raw"
              emptyLabel="No promo clips matched this title."
            />
          </Panel>
        </Reveal>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Reveal delay={0.1}>
          <Panel
            title="Country footprint"
            subtitle="Best rank achieved in each country, and how many weeks it held a slot."
          >
            <DataTable
              rows={footprint.slice(0, 100)}
              columns={[
                { key: "country_name", label: "Country" },
                {
                  key: "best_rank",
                  label: "Best",
                  align: "right",
                  render: (r) =>
                    num(r.best_rank) === 1 ? (
                      <span className="chip">#1</span>
                    ) : (
                      `#${num(r.best_rank)}`
                    ),
                },
                { key: "weeks_present", label: "Weeks", align: "right" },
                { key: "first_week", label: "First", align: "right" },
              ]}
              empty="This title did not chart in any country cut."
            />
          </Panel>
        </Reveal>

        <Reveal delay={0.14}>
          <Panel
            title="Promo clips"
            subtitle="Newest first. Retained 30 days under the YouTube API Developer Policies."
          >
            <DataTable
              rows={clips}
              columns={[
                {
                  key: "video_title",
                  label: "Clip",
                  render: (r) => (
                    <a
                      href={`https://www.youtube.com/watch?v=${str(r.video_id)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="title-link block max-w-[20rem] truncate"
                    >
                      {str(r.video_title)}
                    </a>
                  ),
                },
                { key: "market", label: "Market" },
                {
                  key: "is_short",
                  label: "Format",
                  render: (r) => (num(r.is_short) ? "Short" : "Long"),
                },
                {
                  key: "published_at",
                  label: "Published",
                  align: "right",
                  render: (r) => str(r.published_at).slice(0, 10),
                },
              ]}
              empty="No promo clips matched this title."
            />
          </Panel>
        </Reveal>
      </div>
    </Shell>
  );
}
