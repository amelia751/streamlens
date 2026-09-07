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
  /** Map name → [lng, lat], for drawing arcs between countries. */
  centers: Record<string, [number, number]>;
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
      const centers: Record<string, [number, number]> = {};
      const features = (data.geo as { features?: { properties?: { name?: string }; geometry?: unknown }[] }).features ?? [];
      for (const feature of features) {
        const name = feature.properties?.name;
        if (name && feature.geometry) centers[name] = featureCenter(feature.geometry);
      }
      return { index: data.index, centers };
    })
    .catch((error: unknown) => {
      // Without this the first failure is cached and every later map panel
      // reuses the rejection instead of trying again.
      pending = null;
      throw error;
    });

  return pending;
}

/** Rough centre of a polygon, good enough to aim an arc at. */
function featureCenter(geometry: unknown): [number, number] {
  let sx = 0;
  let sy = 0;
  let n = 0;
  const walk = (node: unknown) => {
    if (Array.isArray(node) && typeof node[0] === "number") {
      sx += node[0] as number;
      sy += node[1] as number;
      n += 1;
      return;
    }
    if (Array.isArray(node)) node.forEach(walk);
  };
  walk((geometry as { coordinates?: unknown }).coordinates);
  return n ? [sx / n, sy / n] : [0, 0];
}

/** The map's name for a country, given whatever the query called it. */
export function resolvePlace(atlas: WorldAtlas, raw: unknown): string | undefined {
  const key = String(raw ?? "").trim();
  if (!key) return undefined;
  return atlas.index[key.toUpperCase()] ?? atlas.index[key.toLowerCase()];
}
