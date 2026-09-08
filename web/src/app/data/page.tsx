import { runQuery, str } from "@/lib/api";

import {
  DataDesk,
  type GreenlightData,
  type PromoData,
  type RolloutData,
} from "./desk";
import { parseView } from "./view";

export const dynamic = "force-dynamic";

export const metadata = { title: "Data" };

const CATEGORIES = ["Films", "TV"];

type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

async function settle<T>(fn: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

export default async function DataPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; week?: string; category?: string }>;
}) {
  const sp = await searchParams;
  const view = parseView(sp.view);
  const category = CATEGORIES.includes(sp.category ?? "")
    ? sp.category!
    : "Films";

  const [greenlight, rollout, promo] = await Promise.all([
    settle<GreenlightData>(async () => {
      const [b, f] = await Promise.all([
        runQuery("greenlight_board", { limit: 2000 }),
        runQuery("greenlight_facets"),
      ]);
      return {
        board: b.rows,
        categories: f.rows.map((r) => str(r.category)).filter(Boolean),
      };
    }),
    settle<RolloutData>(async () => {
      const w = await runQuery("rollout_weeks");
      const weeks = w.rows.map((r) => str(r.week));
      const week = weeks.includes(sp.week ?? "") ? sp.week! : weeks[0];
      const c = await runQuery("rollout_countries", {
        week,
        category,
        limit: 5000,
      });
      return { rows: c.rows, weeks, week, category };
    }),
    settle<PromoData>(async () => {
      const [c, ca, cp] = await Promise.all([
        runQuery("promo_channels"),
        runQuery("promo_cadence_detail", { months: 60 }),
        runQuery("promo_campaigns", { limit: 25 }),
      ]);
      return { channels: c.rows, cadence: ca.rows, campaigns: cp.rows };
    }),
  ]);

  return (
    <DataDesk
      view={view}
      greenlight={greenlight}
      rollout={rollout}
      promo={promo}
    />
  );
}
