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
      <Shell title="The Greenlight Room" {...ROOMS.greenlight}>
        <ErrorNote error={error} />
      </Shell>
    );
  }

  return (
    <Shell
      title="The Greenlight Room"
      lede="Every title Netflix promoted on YouTube, set against how it actually performed in the Weekly Top 10. The question this answers is whether the promotional push matched the outcome — and where it did not."
      {...ROOMS.greenlight}
    >
      <GreenlightBoard board={board} categories={categories} />
    </Shell>
  );
}
