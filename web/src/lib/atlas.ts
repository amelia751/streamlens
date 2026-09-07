/**
 * The world map geometry, fetched once and registered with ECharts.
 *
 * Map panels are rare next to lines and bars, and the geometry is 180KB, so
 * it is not worth putting in the bundle every visitor downloads. It is
 * fetched the first time a map panel renders and shared from then on.
 *
 * The file also carries a lookup built by `scripts/build-world-map.mjs`,
 * which is what lets a query key on whatever it happens to hold — "US",
 * "USA", "United States" — rather than on Natural Earth's exact spelling.
 */

import * as echarts from "echarts";

export type WorldAtlas = {
  /** Country name, ISO2 and ISO3 all pointing at the map's own name. */
  index: Record<string, string>;
};

export const WORLD_MAP = "world";

let pending: Promise<WorldAtlas> | null = null;

export function loadWorldAtlas(): Promise<WorldAtlas> {
  pending ??= fetch("/maps/world.json")
    .then(async (res) => {
      if (!res.ok) throw new Error(`world map responded ${res.status}`);
      const data = (await res.json()) as {
        geo: Parameters<typeof echarts.registerMap>[1];
        index: Record<string, string>;
      };
      echarts.registerMap(WORLD_MAP, data.geo);
      return { index: data.index };
    })
    .catch((error: unknown) => {
      // Without this the first failure is cached and every later map panel
      // reuses the rejection instead of trying again.
      pending = null;
      throw error;
    });

  return pending;
}

/** The map's name for a country, given whatever the query called it. */
export function resolvePlace(atlas: WorldAtlas, raw: unknown): string | undefined {
  const key = String(raw ?? "").trim();
  if (!key) return undefined;
  return atlas.index[key.toUpperCase()] ?? atlas.index[key.toLowerCase()];
}
