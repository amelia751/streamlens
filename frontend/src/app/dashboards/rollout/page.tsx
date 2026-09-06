import Link from "next/link";
import { Shell, ErrorNote } from "@/components/shell";
import { Panel, Stat, DataTable, BarList } from "@/components/charts";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { runQuery, commas, num, str } from "@/lib/api";
import { ROOMS } from "@/lib/theme";

export const dynamic = "force-dynamic";

const CATEGORIES = ["Films", "TV"];

export default async function GlobalRollout({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; category?: string }>;
}) {
  const sp = await searchParams;
  const category = CATEGORIES.includes(sp.category ?? "")
    ? sp.category!
    : "Films";

  let weeks: string[] = [];
  let rows: Record<string, unknown>[] = [];
  try {
    const w = await runQuery("rollout_weeks");
    weeks = w.rows.map((r) => str(r.week));
    const week = weeks.includes(sp.week ?? "") ? sp.week! : weeks[0];
    const c = await runQuery("rollout_countries", {
      week,
      category,
      limit: 5000,
    });
    rows = c.rows;
  } catch (error) {
    return (
      <Shell title="The Global Rollout" {...ROOMS.rollout}>
        <ErrorNote error={error} />
      </Shell>
    );
  }

  const week = weeks.includes(sp.week ?? "") ? sp.week! : weeks[0];

  // A title's reach is how many countries it charted in that week; its
  // strength is how often it took the number one slot.
  const byTitle = Object.values(
    rows.reduce<
      Record<
        string,
        { title: string; countries: number; firsts: number; best: number }
      >
    >((acc, r) => {
      const t = str(r.title);
      acc[t] ??= { title: t, countries: 0, firsts: 0, best: 99 };
      acc[t].countries += 1;
      if (num(r.rank) === 1) acc[t].firsts += 1;
      acc[t].best = Math.min(acc[t].best, num(r.rank));
      return acc;
    }, {}),
  ).sort((a, b) => b.countries - a.countries);

  const countries = new Set(rows.map((r) => str(r.country))).size;
  const number_ones = rows.filter((r) => num(r.rank) === 1);

  return (
    <Shell
      title="The Global Rollout"
      lede="The Netflix Weekly Top 10 by country. A title that tops the chart in 60 countries is a different asset from one that tops it in three, and the country cut is where that difference shows."
      {...ROOMS.rollout}
    >
      <form className="mb-6 flex flex-wrap items-end gap-3" action="">
        <div className="field">
          <label htmlFor="week">Week</label>
          <select id="week" name="week" defaultValue={week}>
            {weeks.slice(0, 160).map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="category">Category</label>
          <select id="category" name="category" defaultValue={category}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="pill on">
          Update
        </button>
      </form>

      <Stagger className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StaggerItem>
          <Stat
            label="Countries charting"
            value={commas(countries)}
            hint={`week of ${week}`}
            index={2}
          />
        </StaggerItem>
        <StaggerItem>
          <Stat label="Distinct titles" value={commas(byTitle.length)} index={3} />
        </StaggerItem>
        <StaggerItem>
          <Stat label="Chart entries" value={commas(rows.length)} index={4} />
        </StaggerItem>
        <StaggerItem>
          <Stat
            label="Widest #1"
            value={`${commas(Math.max(...byTitle.map((t) => t.firsts), 0))} countries`}
            index={0}
          />
        </StaggerItem>
      </Stagger>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
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
              }))}
              format="raw"
            />
          </Panel>
        </Reveal>

        <Reveal delay={0.08}>
          <Panel
            title="Number one, by country"
            subtitle="Who took the top slot where."
          >
            <DataTable
              rows={number_ones.slice(0, 200)}
              columns={[
                { key: "country_name", label: "Country" },
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
          <DataTable
            rows={rows.slice(0, 400)}
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
                render: (r) => (
                  <Link
                    href={`/dashboards/title/${encodeURIComponent(str(r.title))}`}
                    className="title-link"
                  >
                    {str(r.title)}
                  </Link>
                ),
              },
              { key: "weeks_charted", label: "Weeks in Top 10", align: "right" },
            ]}
          />
        </Panel>
      </Reveal>
    </Shell>
  );
}
