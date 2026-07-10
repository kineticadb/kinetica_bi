import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { useFilterHighlightStore } from "./filterHighlightStore";

describe("filterHighlightStore", () => {
  it("initial state: empty highlightedIds, empty flashingIds, flashNonce 0", () => {
    const s = useFilterHighlightStore.getState();
    expect(s.highlightedIds.size).toBe(0);
    expect(s.flashingIds.size).toBe(0);
    expect(s.flashNonce).toBe(0);
  });

  it("setHighlighted([3,7]) populates highlightedIds with a NEW Set reference", () => {
    const prevRef = useFilterHighlightStore.getState().highlightedIds;
    useFilterHighlightStore.getState().setHighlighted([3, 7]);
    const s = useFilterHighlightStore.getState();
    expect(s.highlightedIds.has(3)).toBe(true);
    expect(s.highlightedIds.has(7)).toBe(true);
    expect(s.highlightedIds).not.toBe(prevRef);
  });

  it("clearHighlighted() empties highlightedIds", () => {
    useFilterHighlightStore.getState().setHighlighted([1, 2]);
    useFilterHighlightStore.getState().clearHighlighted();
    expect(useFilterHighlightStore.getState().highlightedIds.size).toBe(0);
  });

  it("flash([5]) sets flashingIds and increments flashNonce; re-firing increments again even with an identical id set", () => {
    const s0 = useFilterHighlightStore.getState();
    expect(s0.flashNonce).toBe(0);
    useFilterHighlightStore.getState().flash([5]);
    const s1 = useFilterHighlightStore.getState();
    expect(s1.flashingIds.has(5)).toBe(true);
    expect(s1.flashNonce).toBe(1);
    useFilterHighlightStore.getState().flash([5]);
    const s2 = useFilterHighlightStore.getState();
    expect(s2.flashingIds.has(5)).toBe(true);
    expect(s2.flashNonce).toBe(2);
  });

  it("reset() clears highlightedIds, flashingIds, and flashNonce", () => {
    useFilterHighlightStore.getState().setHighlighted([1]);
    useFilterHighlightStore.getState().flash([2]);
    useFilterHighlightStore.getState().reset();
    const s = useFilterHighlightStore.getState();
    expect(s.highlightedIds.size).toBe(0);
    expect(s.flashingIds.size).toBe(0);
    expect(s.flashNonce).toBe(0);
  });
});

describe("filterHighlightStore reset-chain wiring (source-grep)", () => {
  it("DashboardsPage.tsx registers useFilterHighlightStore.getState().reset()", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../components/DashboardsPage.tsx"),
      "utf8"
    );
    expect(src).toContain("useFilterHighlightStore.getState().reset()");
  });

  it("App.tsx registers useFilterHighlightStore.getState().reset()", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");
    expect(src).toContain("useFilterHighlightStore.getState().reset()");
  });
});

describe("Phase 108 CSS class-presence + tokens-only assertion", () => {
  const cssPath = path.resolve(__dirname, "../styles/global.css");
  const css = fs.readFileSync(cssPath, "utf8");

  it("global.css contains all new ring/flash/applies-to classes", () => {
    expect(css).toContain(".widget-card--highlighted");
    expect(css).toContain(".widget-card--flashing");
    expect(css).toContain("@keyframes widget-flash");
    expect(css).toContain(".filter-panel-chip-applies");
    expect(css).toContain(".applies-to-row");
  });

  it("the newly-added Phase 108 rules contain no #hex literal and no rgba(", () => {
    const startMarker = "/* Phase 108 (FSCOPE-V120-02): steady hover ring";
    const startIdx = css.indexOf(startMarker);
    expect(startIdx).toBeGreaterThan(-1);
    // Phase 108 additions run from the ring comment through the end of the applies-to-row
    // focus-visible rule (the last rule added in Task 1) — slice generously to the end of file
    // since these are the last rules added to the file at execution time.
    const endMarker = ".applies-to-row:focus-visible";
    const endIdx = css.indexOf(endMarker);
    expect(endIdx).toBeGreaterThan(startIdx);
    const endOfBlock = css.indexOf("}", endIdx) + 1;
    const block = css.slice(startIdx, endOfBlock);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/rgba\(/);
  });
});
