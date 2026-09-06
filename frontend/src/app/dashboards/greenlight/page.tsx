import Link from "next/link";
import { Shell, ErrorNote } from "@/components/shell";
import {
  Panel,
  Stat,
  DataTable,
  BarList,
  MismatchScatter,
} from "@/components/charts";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { runQuery, compact, commas, num, str } from "@/lib/api";
import { ROOMS } from "@/lib/theme";

export const dynamic = "force-dynamic";

export default async function GreenlightRoom() {
  let kpis: Record<string, unknown> = {};
  let board: Record<string, unknown>[] = [];
  try {
    const [k, b] = await Promise.all([
      runQuery("greenlight_kpis"),
      runQuery("greenlight_board", { limit: 60 }),
    ]);
    kpis = k.rows[0] ?? {};
    board = b.rows;
  } catch (error) {
    return (
      <Shell title="The Greenlight Room" {...ROOMS.greenlight}>
        <ErrorNote error={error} />
      </Shell>
    );
  }

  // The interesting cell is the mismatch: heavy promo that never charted well,
  // and light promo that ran for months.
  const overPromoted = [...board]
    .filter((r) => num(r.channels) >= 3 && num(r.best_rank) > 3)
    .sort((a, b) => num(b.channels) - num(a.channels))
    .slice(0, 8);

  const efficient = [...board]
    .filter((r) => num(r.clips) > 0 && num(r.weeks_charted) >= 3)
    .sort((a, b) => num(b.hours_per_clip) - num(a.hours_per_clip))
    .slice(0, 8);

  const scatter = board.map((r) => ({
    title: str(r.title),
    channels: num(r.channels),
    rank: num(r.best_rank),
    hours: num(r.hours_viewed),
    clips: num(r.clips),
  }));

  return (
    <Shell
      title="The Greenlight Room"
      lede="Every title Netflix promoted on YouTube, set against how it actually performed in the Weekly Top 10. The question this answers is whether the promotional push matched the outcome — and where it did not."
      {...ROOMS.greenlight}
    >
      <Stagger className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          {
            label: "Linked titles",
            value: commas(kpis.linked_titles),
            hint: "promo ↔ Top 10",
          },
          { label: "Promo clips", value: commas(kpis.clips) },
          {
            label: "Widest campaign",
            value: `${commas(kpis.widest_campaign)} ch`,
            hint: "of 44 channels",
          },
          {
            label: "Reached #1",
            value: commas(kpis.reached_number_one),
            hint: "global weekly rank",
          },
          {
            label: "Hours viewed",
            value: compact(kpis.hours_viewed),
            hint: "Netflix published",
          },
        ].map((s, i) => (
          <StaggerItem key={s.label}>
            <Stat {...s} index={i} />
          </StaggerItem>
        ))}
      </Stagger>

      <Reveal className="mb-6">
        <Panel
          title="Push against rank"
          subtitle="Each dot is a title. Further right is more YouTube channels. Higher on the chart is a better global rank. Size is hours viewed."
        >
          <MismatchScatter points={scatter} />
        </Panel>
      </Reveal>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Reveal delay={0.08}>
          <Panel
            title="Heavy push, weak chart"
            subtitle="Promoted across three or more channels but never broke the global top 3. The cases worth asking about."
          >
            <BarList
              tone="yellow"
              data={overPromoted.map((r) => ({
                label: str(r.title),
                value: num(r.channels),
                note: `best #${num(r.best_rank)} · ${num(r.clips)} clips`,
              }))}
              format="channels"
              emptyLabel="Nothing in this quadrant yet — backfill still running."
            />
          </Panel>
        </Reveal>

        <Reveal delay={0.14}>
          <Panel
            title="Most reach per clip"
            subtitle="Hours viewed divided by promo clips, among titles that charted at least three weeks. A Streamlens ratio, not a Netflix or YouTube metric."
          >
            <BarList
              tone="green"
              data={efficient.map((r) => ({
                label: str(r.title),
                value: num(r.hours_per_clip),
                note: `${num(r.clips)} clips · ${num(r.weeks_charted)}w`,
              }))}
            />
          </Panel>
        </Reveal>
      </div>

      <Reveal delay={0.18}>
        <Panel
          title="Campaign board"
          subtitle="Ranked by how many of the 44 Netflix channels carried the title. Select a title to open its dossier."
        >
          <DataTable
            rows={board}
            columns={[
              {
                key: "title",
                label: "Title",
                render: (r) => (
                  <Link
                    href={`/dashboards/title/${encodeURIComponent(str(r.title))}`}
                    className="title-link"
                  >
                    {str(r.title)}
                  </Link>
                ),
              },
              { key: "channels", label: "Channels", align: "right" },
              { key: "clips", label: "Clips", align: "right" },
              {
                key: "shorts",
                label: "Shorts",
                align: "right",
                render: (r) =>
                  `${Math.round((num(r.shorts) / Math.max(num(r.clips), 1)) * 100)}%`,
              },
              {
                key: "best_rank",
                label: "Best rank",
                align: "right",
                render: (r) =>
                  num(r.best_rank) === 1 ? (
                    <span className="chip">#1</span>
                  ) : (
                    `#${num(r.best_rank)}`
                  ),
              },
              { key: "weeks_charted", label: "Weeks", align: "right" },
              {
                key: "hours_viewed",
                label: "Hours viewed",
                align: "right",
                render: (r) => compact(r.hours_viewed),
              },
            ]}
          />
        </Panel>
      </Reveal>
    </Shell>
  );
}
