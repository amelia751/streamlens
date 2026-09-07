/**
 * Builds the world map asset the `map` panel type renders on.
 *
 * ECharts stopped shipping map geometry in v4, so the geometry has to come
 * from somewhere. Natural Earth's 110m country set is the right size for a
 * dashboard tile: at that resolution the whole world is a few hundred
 * kilobytes, and a choropleth cannot show more detail than that anyway.
 *
 * The source carries about ninety properties per country and full-precision
 * coordinates, nearly all of which is dead weight for shading a country by
 * one number. This keeps the geometry, rounds it to two decimals — roughly
 * a kilometre, well under one screen pixel at world scale — and builds a
 * lookup so a query can key on either an ISO code or a country name.
 *
 * Run with `node scripts/build-world-map.mjs`. The output is committed, so
 * this is only needed when the source or the resolution changes.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "maps", "world.json");

/** Two decimals. Anything finer is invisible at the size a panel draws. */
const PLACES = 2;

function roundCoords(node) {
  if (typeof node[0] === "number") {
    return [
      Math.round(node[0] * 10 ** PLACES) / 10 ** PLACES,
      Math.round(node[1] * 10 ** PLACES) / 10 ** PLACES,
    ];
  }
  return node.map(roundCoords);
}

// Natural Earth's own names, in the order we trust them. A country appears
// in this index under every name and code it is known by, so a query can
// say "US", "United States" or "United States of America".
const NAME_KEYS = ["NAME", "NAME_LONG", "ADMIN", "SOVEREIGNT", "BRK_NAME", "FORMAL_EN"];

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`${SOURCE} responded ${response.status}`);
const source = await response.json();

// Nothing is ever reported against these, and they sit so far south that
// keeping them costs a third of the map's height to draw empty ice.
const POLAR = new Set(["Antarctica", "Fr. S. Antarctic Lands"]);

const index = {};
const features = source.features.flatMap((feature) => {
  const props = feature.properties;
  const name = props.NAME;
  if (POLAR.has(name)) return [];

  // ISO_A2 is "-99" for a handful of countries whose coding is disputed;
  // Natural Earth keeps the real code in ISO_A2_EH for exactly this case.
  for (const iso of [props.ISO_A2, props.ISO_A2_EH, props.ISO_A3]) {
    const code = String(iso ?? "").trim();
    if (code && code !== "-99") index[code.toUpperCase()] = name;
  }
  for (const key of NAME_KEYS) {
    const value = props[key];
    if (value) index[String(value).toLowerCase()] = name;
  }

  return [
    {
      type: "Feature",
      properties: { name },
      geometry: {
        type: feature.geometry.type,
        coordinates: roundCoords(feature.geometry.coordinates),
      },
    },
  ];
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({ geo: { type: "FeatureCollection", features }, index }),
);

const kb = (JSON.stringify({ geo: { features }, index }).length / 1024) | 0;
console.log(`${features.length} countries, ${Object.keys(index).length} lookup keys, ~${kb}KB`);
console.log(`wrote ${OUT}`);
