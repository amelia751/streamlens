"use client";

/**
 * The Global Rollout, filtered.
 *
 * Week and category change the underlying query, so those navigate and let the
 * server refetch; useTransition keeps the previous week on screen while the
 * next one loads instead of flashing an empty panel. Country and title search
 * run against the week already in memory, so they stay instant.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel, Stat, Stats, BarList } from "@/components/charts";
import { SortableTable } from "@/components/charts/sortable-table";
import { TitleLink } from "@/components/title-link";
import {
  ControlBar,
  Select,
  Segmented,
  SearchInput,
} from "@/components/controls";
import { Reveal } from "@/components/motion";
import { commas, num, str, type Row } from "@/lib/api";

export function RolloutAtlas({
  rows,
  weeks,
  week,
  category,
}: {
  rows: Row[];
  weeks: string[];
  week: string;
  category: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [countryQ, setCountryQ] = useState("");
  const [titleQ, setTitleQ] = useState("");

  function go(next: { week?: string; category?: string }) {
    const params = new URLSearchParams({
      week: next.week ?? week,
      category: next.category ?? category,
    });
    startTransition(() => router.push(`/dashboards/rollout?${params}`));
  }

  const filtered = useMemo(() => {
    const c = countryQ.trim().toLowerCase();
    const t = titleQ.trim().toLowerCase();
    return rows.filter((r) => {
      if (c && !str(r.country_name).toLowerCase().includes(c)) return false;
      if (t && !str(r.title).toLowerCase().includes(t)) return false;
      return true;
    });
  }, [rows, countryQ, titleQ]);

  // Reach is how many countries a title charted in this week; strength is how
  // often it took the top slot.
  const byTitle = useMemo(() => {
    const acc = new Map<
      string,
      { title: string; countries: number; firsts: number; best: number }
    >();
    for (const r of filtered) {
      const t = str(r.title);
      const cur = acc.get(t) ?? { title: t, countries: 0, firsts: 0, best: 99 };
      cur.countries += 1;
      if (num(r.rank) === 1) cur.firsts += 1;
      cur.best = Math.min(cur.best, num(r.rank));
      acc.set(t, cur);
    }
    return [...acc.values()].sort((a, b) => b.countries - a.countries);
  }, [filtered]);

  const countries = new Set(filtered.map((r) => str(r.country))).size;
  const numberOnes = filtered.filter((r) => num(r.rank) === 1);
  const dirty = countryQ !== "" || titleQ !== "";

  return (
    <>
      <ControlBar
        dirty={dirty}
        onReset={() => {
          setCountryQ("");
          setTitleQ("");
        }}
        resultLabel={
          pending
            ? "Loading week…"
            : `${commas(filtered.length)} of ${commas(rows.length)} placements`
        }
      >
        <Select
          label="Week"
          value={week}
          onChange={(w) => go({ week: w })}
          options={weeks.map((w) => ({ value: w, label: w }))}
        />
        <Segmented
          label="Category"
          value={category}
          onChange={(c) => go({ category: c })}
          options={[
            { value: "Films", label: "Films" },
            { value: "TV", label: "TV" },
          ]}
        />
        <SearchInput
          label="Country"
          value={countryQ}
          onChange={setCountryQ}
          placeholder="Search countries…"
        />
        <SearchInput
          label="Title"
          value={titleQ}
          onChange={setTitleQ}
          placeholder="Search titles…"
        />
      </ControlBar>

      <div style={{ opacity: pending ? 0.55 : 1, transition: "opacity .15s" }}>
        <Stats>
          <Stat
            label="Countries charting"
            value={commas(countries)}
            hint={`week of ${week}`}
          />
          <Stat label="Distinct titles" value={commas(byTitle.length)} />
          <Stat label="Chart entries" value={commas(filtered.length)} />
          <Stat
            label="Widest #1"
            value={commas(Math.max(...byTitle.map((t) => t.firsts), 0))}
            hint="countries"
          />
        </Stats>

        <div className="mb-5 grid gap-4 lg:grid-cols-2">
          <Reveal>
            <Panel
              title="Widest reach"
              subtitle="Countries where the title appeared anywhere in the Top 10 this week."
            >
              <BarList
                tone="blue"
                data={byTitle.slice(0, 12).map((t) => ({
                  label: t.title,
                  value: t.countries,
                  note: t.firsts ? `#1 in ${t.firsts}` : `best #${t.best}`,
                  dossier: true,
                }))}
                format="raw"
                emptyLabel="No placements match this search."
              />
            </Panel>
          </Reveal>

          <Reveal delay={0.08}>
            <Panel
              title="Number one, by country"
              subtitle="Who took the top slot where. Select any column to sort."
            >
              <SortableTable
                rows={numberOnes}
                initialSort="country_name"
                initialDir="asc"
                empty="No number ones match this search."
                columns={[
                  { key: "country_name", label: "Country" },
                  {
                    key: "title",
                    label: "Title",
                    render: (r) => <TitleLink title={str(r.title)} />,
                  },
                  { key: "weeks_charted", label: "Weeks", align: "right" },
                ]}
              />
            </Panel>
          </Reveal>
        </div>

        <Reveal delay={0.12}>
          <Panel
            title="Full country chart"
            subtitle={`All Top 10 placements for ${category} in the week of ${week}.`}
          >
            <SortableTable
              rows={filtered}
              initialSort="country_name"
              initialDir="asc"
              empty="No placements match this search."
              columns={[
                { key: "country_name", label: "Country" },
                {
                  key: "rank",
                  label: "Rank",
                  align: "right",
                  render: (r) =>
                    num(r.rank) === 1 ? (
                      <span className="chip">#1</span>
                    ) : (
                      `#${num(r.rank)}`
                    ),
                },
                {
                  key: "title",
                  label: "Title",
                  render: (r) => <TitleLink title={str(r.title)} />,
                },
                {
                  key: "weeks_charted",
                  label: "Weeks in Top 10",
                  align: "right",
                },
              ]}
            />
          </Panel>
        </Reveal>
      </div>
    </>
  );
}
