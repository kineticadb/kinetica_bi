/**
 * Quick 261116-mdt — Manage Dashboard Tables column alignment.
 *
 * Every row of that modal is its own CSS grid, so columns line up only when each row gets the SAME
 * fixed tracks. Two defects broke that:
 *  1. `.dash-tables-grid` (one class) lost to the later `.ds-header, .ds-row` rule (one class, later
 *     wins), so rows got the Datasets page's 5-column template for 4 cells;
 *  2. `fr` tracks without `minmax(0, …)` grow to each row's own content (a long name pushed its row's
 *     Schema/Columns/Add right).
 * jsdom does no layout, so this pins the structural precondition; the alignment itself was checked live.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(__dirname, "global.css"), "utf8");

describe("Manage Dashboard Tables grid (MDT)", () => {
  it("MDT-1 the 4-column template out-ranks .ds-row/.ds-header and uses content-independent tracks", () => {
    const m = /\.ds-header\.dash-tables-grid,\s*\.ds-row\.dash-tables-grid\s*\{([^}]*)\}/.exec(css);
    expect(m, "compound .ds-row.dash-tables-grid rule").not.toBeNull();
    const tracks = /grid-template-columns:\s*([^;]+);/.exec(m![1])![1].trim().split(/\s+(?![^(]*\))/);
    expect(tracks).toHaveLength(4);
    for (const t of tracks) expect(t, t).not.toMatch(/^(auto|\d*\.?\d*fr|max-content|min-content)$/);
  });

  it("MDT-2 long table names wrap inside their cell instead of widening the row", () => {
    expect(css).toMatch(/\.dash-tables-grid\s*>\s*span\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/);
  });
});
