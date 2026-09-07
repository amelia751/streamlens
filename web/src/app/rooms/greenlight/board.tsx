"use client";

/**
 * The Greenlight Room, filtered.
 *
 * The whole linked catalogue arrives in one fetch and every control filters it
 * in the browser. At roughly a thousand rows that is instant, and it means the
 * headline counters, the scatter, both rankings and the table always describe
 * the same slice — a filter that only moved the table would quietly leave the
 * KPIs describing a different population.
 */
import { useMemo, useState } from "react";
import { Panel, Stat, Stats, BarList, MismatchScatter } from "@/components/charts";
import { TitleLink, useTitleDialog } from "@/components/title-link";
import { SortableTable } from "@/components/charts/sortable-table";
import {
  ControlBar,
  Select,
  SearchInput,
  Segmented,
  RangeSlider,
} from "@/components/controls";
import { Reveal } from "@/components/motion";
import { compact, commas, num, str, type Row } from "@/lib/api";

type Outcome = "all" | "one" | "top3" | "missed";

const OUTCOME_OPTIONS: { value: Outcome; label: string }[] = [
  { value: "all", label: "All" },
  { value: "one", label: "#1" },
  { value: "top3", label: "Top 3" },
  { value: "missed", label: "Missed" },
];

export function GreenlightBoard({
  board,
  categories,
}: {
  board: Row[];
  categories: string[];
}) {
  const { open } = useTitleDialog();
  const [category, setCategory] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("all");
  const [minChannels, setMinChannels] = useState(1);
  const [search, setSearch] = useState("");

  const maxChannels = useMemo(
    () => Math.max(...board.map((r) => num(r.channels)), 1),
    [board],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return board.filter((r) => {
      if (category && str(r.category) !== category) return false;
      if (num(r.channels) < minChannels) return false;
      if (q && !str(r.title).toLowerCase().includes(q)) return false;
      const rank = num(r.best_rank);
      if (outcome === "one" && rank !== 1) return false;
      if (outcome === "top3" && rank > 3) return false;
      if (outcome === "missed" && rank <= 3) return false;
      return true;
    });
  }, [board, category, minChannels, search, outcome]);

  // Recomputed from the filtered slice so the headline always matches what is
  // drawn below it.
  const kpis = useMemo(() => {
    const clips = rows.reduce((s, r) => s + num(r.clips), 0);
    return {
      titles: rows.length,
      clips,
      widest: rows.reduce((m, r) => Math.max(m, num(r.channels)), 0),
      numberOne: rows.filter((r) => num(r.best_rank) === 1).length,
      hours: rows.reduce((s, r) => s + num(r.hours_viewed), 0),
    };
  }, [rows]);

  const overPromoted = useMemo(
    () =>
      [...rows]
        .filter((r) => num(r.channels) >= 3 && num(r.best_rank) > 3)
        .sort((a, b) => num(b.channels) - num(a.channels))
        .slice(0, 8),
    [rows],
  );

  const efficient = useMemo(
    () =>
      [...rows]
        .filter((r) => num(r.clips) > 0 && num(r.weeks_charted) >= 3)
        .sort((a, b) => num(b.hours_per_clip) - num(a.hours_per_clip))
        .slice(0, 8),
    [rows],
  );

  const scatter = useMemo(
    () =>
      rows.map((r) => ({
        title: str(r.title),
        channels: num(r.channels),
        rank: num(r.best_rank),
        hours: num(r.hours_viewed),
        clips: num(r.clips),
        weeks: num(r.weeks_charted),
      })),
    [rows],
  );

  const dirty =
    category !== "" || outcome !== "all" || minChannels !== 1 || search !== "";

  function reset() {
    setCategory("");
    setOutcome("all");
    setMinChannels(1);
    setSearch("");
  }

  return (
    <>
      <Stats>
        <Stat label="Titles" value={commas(kpis.titles)} hint="promo ↔ Top 10" />
        <Stat label="Promo clips" value={commas(kpis.clips)} />
        <Stat
          label="Widest campaign"
          value={`${commas(kpis.widest)} ch`}
          hint="of 44 channels"
        />
        <Stat
          label="Reached #1"
          value={commas(kpis.numberOne)}
          hint="global weekly rank"
        />
        <Stat
          label="Hours viewed"
          value={compact(kpis.hours)}
          hint="Netflix published"
        />
      </Stats>

      <ControlBar
        dirty={dirty}
        onReset={reset}
        resultLabel={`${commas(rows.length)} of ${commas(board.length)} titles`}
      >
        <Select
          label="Chart"
          value={category}
          onChange={setCategory}
          options={[
            { value: "", label: "All categories" },
            ...categories.map((c) => ({ value: c, label: c })),
          ]}
        />
        <Segmented
          label="Outcome"
          value={outcome}
          onChange={(v) => setOutcome(v as Outcome)}
          options={OUTCOME_OPTIONS.map((o) => ({
            ...o,
            tone: o.value === "one" ? ("green" as const) : undefined,
          }))}
        />
        <RangeSlider
          label="Min channels"
          value={minChannels}
          min={1}
          max={Math.max(maxChannels, 2)}
          onChange={setMinChannels}
        />
        <SearchInput
          label="Title"
          value={search}
          onChange={setSearch}
          placeholder="Search titles…"
        />
      </ControlBar>

      <Reveal className="mb-5">
        <Panel
          title="Push against outcome"
          subtitle="Each dot is a title. Further right is more YouTube channels behind it; higher is more hours viewed, on a log scale. Dots below the median line returned less than half the catalogue despite their push."
        >
          <MismatchScatter points={scatter} onSelectTitle={open} />
        </Panel>
      </Reveal>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Reveal delay={0.06}>
          <Panel
            title="Heavy push, weak chart"
            subtitle="Promoted across three or more channels but never broke the global top 3."
          >
            <BarList
              tone="yellow"
              data={overPromoted.map((r) => ({
                label: str(r.title),
                value: num(r.channels),
                note: `best #${num(r.best_rank)} · ${num(r.clips)} clips`,
                dossier: true,
              }))}
              format="channels"
              emptyLabel="No titles in this quadrant for the current filters."
            />
          </Panel>
        </Reveal>

        <Reveal delay={0.1}>
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
                dossier: true,
              }))}
              emptyLabel="No titles charted three weeks under the current filters."
            />
          </Panel>
        </Reveal>
      </div>

      <Reveal delay={0.14}>
        <Panel
          title="Campaign board"
          subtitle="Select any column to sort. Select a title to open its dossier."
        >
          <SortableTable
            rows={rows}
            initialSort="channels"
            columns={[
              {
                key: "title",
                label: "Title",
                render: (r) => <TitleLink title={str(r.title)} />,
              },
              { key: "category", label: "Chart" },
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
              {
                key: "hours_per_clip",
                label: "Hours / clip",
                align: "right",
                render: (r) => compact(r.hours_per_clip),
              },
            ]}
          />
        </Panel>
      </Reveal>
    </>
  );
}
