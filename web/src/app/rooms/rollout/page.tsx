import { Shell, ErrorNote } from "@/components/shell";
import { runQuery, str, type Row } from "@/lib/api";
import { ROOMS } from "@/lib/theme";
import { RolloutAtlas } from "./atlas";

export const dynamic = "force-dynamic";

export const metadata = { title: "Rollout" };

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
  let rows: Row[] = [];
  let week = "";
  try {
    const w = await runQuery("rollout_weeks");
    weeks = w.rows.map((r) => str(r.week));
    week = weeks.includes(sp.week ?? "") ? sp.week! : weeks[0];
    const c = await runQuery("rollout_countries", {
      week,
      category,
      limit: 5000,
    });
    rows = c.rows;
  } catch (error) {
    return (
      <Shell title="Rollout" {...ROOMS.rollout}>
        <ErrorNote error={error} />
      </Shell>
    );
  }

  return (
    <Shell
      title="Rollout"
      lede="The Weekly Top 10 across 94 countries. Which titles travel, and which stay home."
      {...ROOMS.rollout}
    >
      <RolloutAtlas
        rows={rows}
        weeks={weeks}
        week={week}
        category={category}
      />
    </Shell>
  );
}
