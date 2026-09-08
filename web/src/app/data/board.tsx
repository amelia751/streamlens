"use client";

/**
 * Title performance: promo against the Weekly Top 10.
 *
 * The whole linked catalogue arrives in one fetch and every control filters it
 * in the browser. At roughly a thousand rows that is instant, and it means the
 * headline counters, the scatter, and both rankings always describe the same
 * slice.
 */
import { useMemo, useState } from "react";
import { Panel, Stat, Stats, BarList, MismatchScatter } from "@/components/charts";
import { useTitleDialog } from "@/components/title-link";
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
type RankLens = "missed" | "efficient";

const RANK_LENSES: Record<
  RankLens,
  {
    label: string;
    promo: string;
    countries: string;
    tone: "yellow" | "green";
    format: "channels" | "compact";
  }
> = {
  missed: {
    label: "Missed top 3",
    promo: "Three or more channels, never the global top 3.",
    countries: "This week's country reach for that same slice.",
    tone: "yellow",
    format: "channels",
  },
  efficient: {
    label: "Hours / clip",
    promo: "Hours viewed per promo clip. Titles that lasted three weeks or more.",
    countries: "This week's country reach for that same slice.",
    tone: "green",
    format: "compact",
  },
};

const OUTCOME_OPTIONS: { value: Outcome; label: string }[] = [
  { value: "all", label: "All" },
  { value: "one", label: "#1" },
  { value: "top3", label: "Top 3" },
  { value: "missed", label: "Missed" },
];

export type CountryReach = {
  rows: Row[];
  weeks: string[];
  week: string;
  category: string;
  pending?: boolean;
  onWeek: (week: string) => void;
  onCategory: (category: string) => void;
};

export function GreenlightBoard({
  board,
  categories,
  reach,
}: {
  board: Row[];
  categories: string[];
  reach?: CountryReach;
}) {
  const { open } = useTitleDialog();
  const [category, setCategory] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("all");
  const [minChannels, setMinChannels] = useState(1);
  const [search, setSearch] = useState("");
  const [lens, setLens] = useState<RankLens>("missed");

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
        .sort((a, b) => num(b.channels) - num(a.channels)),
    [rows],
  );

  const efficient = useMemo(
    () =>
      [...rows]
        .filter((r) => num(r.clips) > 0 && num(r.weeks_charted) >= 3)
        .sort((a, b) => num(b.hours_per_clip) - num(a.hours_per_clip)),
    [rows],
  );

  const lensRows = lens === "missed" ? overPromoted : efficient;

  const countryReach = useMemo(() => {
    if (!reach) return [];
    const names = new Set(lensRows.map((r) => str(r.title)));
    const acc = new Map<
      string,
      { title: string; countries: number; firsts: number; best: number }
    >();
    for (const r of reach.rows) {
      const t = str(r.title);
      if (!names.has(t)) continue;
      const cur = acc.get(t) ?? { title: t, countries: 0, firsts: 0, best: 99 };
      cur.countries += 1;
      if (num(r.rank) === 1) cur.firsts += 1;
      cur.best = Math.min(cur.best, num(r.rank));
      acc.set(t, cur);
    }
    return [...acc.values()].sort((a, b) => b.countries - a.countries);
  }, [reach, lensRows]);

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
        <Stat label="Titles" value={commas(kpis.titles)} />
        <Stat label="Clips" value={commas(kpis.clips)} />
        <Stat label="Most channels" value={commas(kpis.widest)} />
        <Stat label="#1" value={commas(kpis.numberOne)} />
        <Stat label="Hours viewed" value={compact(kpis.hours)} />
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

      <Reveal className="mb-3">
        <Panel
          title="Channels vs hours"
          subtitle="Each point is a title. Right is more channels behind it; up is more hours viewed."
        >
          <MismatchScatter points={scatter} onSelectTitle={open} />
        </Panel>
      </Reveal>

      {reach && (
        <ControlBar
          resultLabel={
            reach.pending
              ? "Loading week…"
              : `${commas(reach.rows.length)} placements`
          }
        >
          <Select
            label="Week"
            value={reach.week}
            onChange={reach.onWeek}
            options={reach.weeks.map((w) => ({ value: w, label: w }))}
          />
          <Segmented
            label="Category"
            value={reach.category}
            onChange={reach.onCategory}
            options={[
              { value: "Films", label: "Films", tone: "blue" },
              { value: "TV", label: "TV", tone: "blue" },
            ]}
          />
        </ControlBar>
      )}

      <div
        className="mb-3"
        style={{ opacity: reach?.pending ? 0.55 : 1, transition: "opacity .15s" }}
      >
        <div className="filter-chips" style={{ marginBottom: "0.65rem" }}>
          {(Object.keys(RANK_LENSES) as RankLens[]).map((id) => (
            <button
              key={id}
              type="button"
              className={`filter-chip${lens === id ? " on" : ""}`}
              aria-pressed={lens === id}
              onClick={() => setLens(id)}
            >
              {RANK_LENSES[id].label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Reveal delay={0.06}>
            <Panel
              title="Promo vs return"
              subtitle={RANK_LENSES[lens].promo}
            >
              <BarList
                key={`promo-${lens}`}
                tone={RANK_LENSES[lens].tone}
                format={RANK_LENSES[lens].format}
                data={
                  lens === "missed"
                    ? overPromoted.slice(0, 8).map((r) => ({
                        label: str(r.title),
                        value: num(r.channels),
                        note: `best #${num(r.best_rank)} · ${num(r.clips)} clips`,
                        dossier: true,
                      }))
                    : efficient.slice(0, 8).map((r) => ({
                        label: str(r.title),
                        value: num(r.hours_per_clip),
                        note: `${num(r.clips)} clips · ${num(r.weeks_charted)}w`,
                        dossier: true,
                      }))
                }
                emptyLabel={
                  lens === "missed"
                    ? "No titles in this quadrant for the current filters."
                    : "No titles charted three weeks under the current filters."
                }
              />
            </Panel>
          </Reveal>

          {reach && (
            <Reveal delay={0.1}>
              <Panel
                title="Countries in the Top 10"
                subtitle={RANK_LENSES[lens].countries}
              >
                <BarList
                  key={`reach-${lens}`}
                  tone="blue"
                  data={countryReach.slice(0, 8).map((t) => ({
                    label: t.title,
                    value: t.countries,
                    note: t.firsts ? `#1 in ${t.firsts}` : `best #${t.best}`,
                    dossier: true,
                  }))}
                  format="raw"
                  emptyLabel="None of these titles charted this week."
                />
              </Panel>
            </Reveal>
          )}
        </div>
      </div>
    </>
  );
}
