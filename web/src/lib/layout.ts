/**
 * Fitting panels to the twelve-column grid.
 *
 * The curator picks a width per panel, but nothing makes those widths add
 * up to a row. A dashboard of 12, 3, 6, 6 leaves the third panel wrapping
 * with a three-column hole beside it, because CSS grid will not backfill a
 * gap it cannot reorder into.
 *
 * So the stored width is read as a hint at relative importance rather than
 * an exact span: panels are grouped into rows in the order the curator
 * chose, and each row is then scaled to fill exactly twelve columns.
 * Nothing moves, and no row ends short.
 */

import type { Panel } from "@/lib/api";

const COLUMNS = 12;

/**
 * A quarter of the canvas is about the narrowest a panel can be and still
 * hold a formatted figure or a legend. It also caps a row at four.
 */
const MIN_WIDTH = 3;

/** A trailing row narrower than this gets folded into the row above. */
const RUNT = COLUMNS / 2;

function hint(width: number): number {
  if (!Number.isFinite(width)) return 1;
  return Math.min(COLUMNS, Math.max(1, Math.round(width)));
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * The same panels, in the same order, with widths that fill every row.
 *
 * Panels are returned flat because the grid places them itself; the rows
 * here only exist to decide how the columns get shared out.
 */
export function packRows(panels: Panel[]): Panel[] {
  if (panels.length === 0) return panels;

  const rows: Panel[][] = [];
  let row: Panel[] = [];
  let width = 0;

  for (const panel of panels) {
    row.push(panel);
    width += hint(panel.width);
    // Close on reaching a full row rather than before overflowing it: a
    // row of 3 + 6 + 6 is better shared three ways than left at 9 with the
    // third panel pushed onto a line of its own.
    if (width >= COLUMNS || row.length >= COLUMNS / MIN_WIDTH) {
      rows.push(row);
      row = [];
      width = 0;
    }
  }
  if (row.length) rows.push(row);

  // One narrow panel left over would otherwise be stretched across the
  // whole canvas, which looks worse than the gap it was meant to fix.
  const last = rows[rows.length - 1];
  if (
    rows.length > 1 &&
    sum(last.map((p) => hint(p.width))) < RUNT &&
    rows[rows.length - 2].length + last.length <= COLUMNS / MIN_WIDTH
  ) {
    rows[rows.length - 2].push(...last);
    rows.pop();
  }

  return rows.flatMap(fit);
}

/** One row's widths, scaled to land on exactly twelve columns. */
function fit(row: Panel[]): Panel[] {
  const hints = row.map((p) => hint(p.width));
  const total = sum(hints);
  const exact = hints.map((w) => (w * COLUMNS) / total);
  const width = exact.map(Math.floor);

  // Flooring loses under a column each, so the remainder goes back to
  // whichever panels lost the most to rounding.
  const starved = exact
    .map((w, i) => ({ i, lost: w - Math.floor(w) }))
    .sort((a, b) => b.lost - a.lost);

  let spare = COLUMNS - sum(width);
  for (let k = 0; spare > 0 && k < starved.length; k += 1) {
    width[starved[k].i] += 1;
    spare -= 1;
  }

  // A panel rounded below the floor borrows from the widest one, which can
  // afford it. Where several are equally wide the last gives way, since the
  // curator ordered the row and put the panel it cared about first.
  for (let i = 0; i < width.length; i += 1) {
    while (width[i] < MIN_WIDTH) {
      const widest = width.lastIndexOf(Math.max(...width));
      if (width[widest] <= MIN_WIDTH) break;
      width[widest] -= 1;
      width[i] += 1;
    }
  }

  return row.map((panel, i) =>
    panel.width === width[i] ? panel : { ...panel, width: width[i] },
  );
}
