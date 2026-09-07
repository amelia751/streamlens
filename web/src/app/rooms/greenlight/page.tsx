import { Shell, ErrorNote } from "@/components/shell";
import { runQuery, str, type Row } from "@/lib/api";
import { ROOMS } from "@/lib/theme";
import { GreenlightBoard } from "./board";

export const dynamic = "force-dynamic";

export const metadata = { title: "Greenlight" };

export default async function GreenlightRoom() {
  let board: Row[] = [];
  let categories: string[] = [];
  try {
    const [b, f] = await Promise.all([
      runQuery("greenlight_board", { limit: 2000 }),
      runQuery("greenlight_facets"),
    ]);
    board = b.rows;
    categories = f.rows.map((r) => str(r.category)).filter(Boolean);
  } catch (error) {
    return (
      <Shell title="Greenlight" {...ROOMS.greenlight}>
        <ErrorNote error={error} />
      </Shell>
    );
  }

  return (
    <Shell
      title="Greenlight"
      lede="Promotional push against Top 10 outcome, title by title."
      {...ROOMS.greenlight}
    >
      <GreenlightBoard board={board} categories={categories} />
    </Shell>
  );
}
