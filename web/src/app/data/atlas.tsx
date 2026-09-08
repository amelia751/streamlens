"use client";

/**
 * This week's Top 10 slots.
 *
 * Week and category are chosen above, next to the country ranking. This panel
 * is the full list for that same cut.
 */
import { Panel, PlacementsTable } from "@/components/charts";
import { Reveal } from "@/components/motion";
import type { Row } from "@/lib/api";

export function RolloutAtlas({
  rows,
  week,
  category,
  pending,
}: {
  rows: Row[];
  week: string;
  category: string;
  pending?: boolean;
}) {
  return (
    <div style={{ opacity: pending ? 0.55 : 1, transition: "opacity .15s" }}>
      <Reveal delay={0.12}>
        <Panel
          title="Placements"
          subtitle={`Every Top 10 slot for ${category} in the week of ${week}.`}
        >
          <PlacementsTable rows={rows} />
        </Panel>
      </Reveal>
    </div>
  );
}
