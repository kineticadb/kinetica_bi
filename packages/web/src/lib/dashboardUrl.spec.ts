/**
 * lib/dashboardUrl.spec.ts — Phase 113 Plan 01 Task 1 (DLINK-V121-01/06/07).
 *
 * Direct unit spec for the pure param read/build helpers plus the three
 * History-API writers (openDashboardUrl / leaveDashboardUrl / clearDashboardUrl).
 *
 * jsdom DOES implement session-history traversal (pushState -> history.back() ->
 * popstate really fires and window.location.search really rolls back), but it is
 * ASYNCHRONOUS — several macrotask ticks later, not synchronously and not on the
 * next microtask. Every assertion that depends on a traversal is wrapped in
 * waitFor; replaceState/pushState-only assertions are synchronous.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import {
  DASHBOARD_URL_PARAM,
  DASHBOARD_HISTORY_MARKER,
  DASHBOARD_MODE_PARAM,
  readDashboardIdFromSearch,
  readDashboardModeFromSearch,
  buildDashboardUrl,
  openDashboardUrl,
  leaveDashboardUrl,
  clearDashboardUrl,
  hasDashboardParam,
  isValidDashboardId,
  restoreDashboardUrl,
  setDashboardMode,
} from "./dashboardUrl";

describe("dashboardUrl", () => {
  beforeEach(() => {
    // Prevent history/location state leaking between tests or from another spec file
    // (this repo has a documented cross-file contamination history under parallel scheduling).
    window.history.replaceState(null, "", "/");
  });

  describe("DASHBOARD_URL_PARAM / DASHBOARD_HISTORY_MARKER", () => {
    it("exposes the expected constant names", () => {
      expect(DASHBOARD_URL_PARAM).toBe("dashboard");
      expect(DASHBOARD_HISTORY_MARKER).toBe("kbiDashboardEntry");
    });
  });

  describe("readDashboardIdFromSearch", () => {
    it('returns null for ""', () => {
      expect(readDashboardIdFromSearch("")).toBeNull();
    });

    it('returns null for "?foo=1"', () => {
      expect(readDashboardIdFromSearch("?foo=1")).toBeNull();
    });

    it('returns null for "?dashboard="', () => {
      expect(readDashboardIdFromSearch("?dashboard=")).toBeNull();
    });

    it('returns 12 for "?dashboard=12"', () => {
      expect(readDashboardIdFromSearch("?dashboard=12")).toBe(12);
    });

    it('returns 12 for "dashboard=12" (no leading ?)', () => {
      expect(readDashboardIdFromSearch("dashboard=12")).toBe(12);
    });

    it('returns 7 for "?a=1&dashboard=7"', () => {
      expect(readDashboardIdFromSearch("?a=1&dashboard=7")).toBe(7);
    });

    it('returns null for "?dashboard=12abc"', () => {
      expect(readDashboardIdFromSearch("?dashboard=12abc")).toBeNull();
    });

    it('returns null for "?dashboard=1.5"', () => {
      expect(readDashboardIdFromSearch("?dashboard=1.5")).toBeNull();
    });

    it('returns null for "?dashboard=-3"', () => {
      expect(readDashboardIdFromSearch("?dashboard=-3")).toBeNull();
    });

    it('returns null for "?dashboard=0"', () => {
      expect(readDashboardIdFromSearch("?dashboard=0")).toBeNull();
    });
  });

  describe("buildDashboardUrl", () => {
    it("sets the param on a bare path", () => {
      expect(buildDashboardUrl({ pathname: "/", search: "", hash: "" }, 12)).toBe("/?dashboard=12");
    });

    it("removes the sole param, leaving no ?", () => {
      expect(buildDashboardUrl({ pathname: "/", search: "?dashboard=12", hash: "" }, null)).toBe("/");
    });

    it("removes the param but preserves unrelated ones", () => {
      expect(buildDashboardUrl({ pathname: "/", search: "?a=1&dashboard=12", hash: "" }, null)).toBe("/?a=1");
    });

    it("appends the param after existing ones and preserves the hash", () => {
      expect(buildDashboardUrl({ pathname: "/", search: "?a=1", hash: "#x" }, 7)).toBe("/?a=1&dashboard=7#x");
    });

    it("replaces an existing dashboard id rather than duplicating it", () => {
      expect(buildDashboardUrl({ pathname: "/", search: "?dashboard=3", hash: "" }, 9)).toBe("/?dashboard=9");
    });
  });

  describe("openDashboardUrl", () => {
    it("pushes a marked history entry with the dashboard param set", () => {
      openDashboardUrl(12);
      expect(window.location.search).toBe("?dashboard=12");
      expect((window.history.state as Record<string, unknown>)[DASHBOARD_HISTORY_MARKER]).toBe(true);
    });
  });

  describe("clearDashboardUrl", () => {
    let backSpy: ReturnType<typeof vi.spyOn>;
    let pushSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      backSpy = vi.spyOn(window.history, "back");
      pushSpy = vi.spyOn(window.history, "pushState");
    });

    afterEach(() => {
      backSpy.mockRestore();
      pushSpy.mockRestore();
    });

    it("removes the param in place, without navigating or pushing", () => {
      window.history.replaceState(null, "", "/?dashboard=12");
      clearDashboardUrl();
      expect(window.location.search).toBe("");
      expect(backSpy).not.toHaveBeenCalled();
      expect(pushSpy).not.toHaveBeenCalled();
    });

    it("is idempotent when already clean", () => {
      clearDashboardUrl();
      expect(window.location.search).toBe("");
      expect(backSpy).not.toHaveBeenCalled();
      expect(pushSpy).not.toHaveBeenCalled();
    });

    it("preserves unrelated params", () => {
      window.history.replaceState(null, "", "/?a=1&dashboard=12");
      clearDashboardUrl();
      expect(window.location.search).toBe("?a=1");
    });
  });

  describe("leaveDashboardUrl", () => {
    it("pops the pushed entry when we own the current one (popped branch)", async () => {
      openDashboardUrl(12);
      const pushSpy = vi.spyOn(window.history, "pushState");
      const result = leaveDashboardUrl();
      expect(result).toBe("popped");
      expect(pushSpy).not.toHaveBeenCalled();
      // jsdom's back() traversal resolves several macrotask ticks later — this waitFor
      // is mandatory, not stylistic.
      await waitFor(() => expect(window.location.search).toBe(""));
      pushSpy.mockRestore();
    });

    it("writes the list URL when there is no history entry to pop", () => {
      // Exactly what a Phase 114 deep-link arrival looks like: an unmarked entry.
      window.history.replaceState(null, "", "/?dashboard=12");
      const backSpy = vi.spyOn(window.history, "back");
      const result = leaveDashboardUrl();
      expect(result).toBe("wrote");
      // This branch does no traversal, so a synchronous assertion is correct here.
      expect(window.location.search).toBe("");
      expect(backSpy).not.toHaveBeenCalled();
      backSpy.mockRestore();
    });
  });

  describe("isValidDashboardId", () => {
    it("AUTHLINK-115: isValidDashboardId(12) === true", () => {
      expect(isValidDashboardId(12)).toBe(true);
    });

    it("AUTHLINK-115: isValidDashboardId(0) === false", () => {
      expect(isValidDashboardId(0)).toBe(false);
    });

    it("AUTHLINK-115: isValidDashboardId(-3) === false", () => {
      expect(isValidDashboardId(-3)).toBe(false);
    });

    it("AUTHLINK-115: isValidDashboardId(1.5) === false", () => {
      expect(isValidDashboardId(1.5)).toBe(false);
    });

    it("AUTHLINK-115: isValidDashboardId(\"12\") === false — a string is NOT a valid id", () => {
      expect(isValidDashboardId("12")).toBe(false);
    });

    it("AUTHLINK-115: isValidDashboardId(undefined) === false", () => {
      expect(isValidDashboardId(undefined)).toBe(false);
    });

    it("AUTHLINK-115: isValidDashboardId(null) === false", () => {
      expect(isValidDashboardId(null)).toBe(false);
    });

    it("AUTHLINK-115: isValidDashboardId(NaN) === false", () => {
      expect(isValidDashboardId(NaN)).toBe(false);
    });
  });

  describe("restoreDashboardUrl", () => {
    let backSpy: ReturnType<typeof vi.spyOn>;
    let pushSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      backSpy = vi.spyOn(window.history, "back");
      pushSpy = vi.spyOn(window.history, "pushState");
    });

    afterEach(() => {
      backSpy.mockRestore();
      pushSpy.mockRestore();
    });

    it("AUTHLINK-115: restoreDashboardUrl(7) on \"/\" sets window.location.search to \"?dashboard=7\"", () => {
      restoreDashboardUrl(7);
      expect(window.location.search).toBe("?dashboard=7");
      expect(backSpy).not.toHaveBeenCalled();
      expect(pushSpy).not.toHaveBeenCalled();
    });

    it("AUTHLINK-115: restoreDashboardUrl(7) does NOT change history.length (replaceState, never pushState)", () => {
      const lengthBefore = window.history.length;
      restoreDashboardUrl(7);
      expect(window.history.length).toBe(lengthBefore);
      expect(pushSpy).not.toHaveBeenCalled();
    });

    it("AUTHLINK-115: restoreDashboardUrl(7) preserves unrelated params (\"/?a=1\" -> \"?a=1&dashboard=7\")", () => {
      window.history.replaceState(null, "", "/?a=1");
      restoreDashboardUrl(7);
      expect(window.location.search).toBe("?a=1&dashboard=7");
    });

    it("AUTHLINK-115: restoreDashboardUrl(7) is idempotent when the param already reads 7", () => {
      window.history.replaceState(null, "", "/?dashboard=7");
      restoreDashboardUrl(7);
      expect(window.location.search).toBe("?dashboard=7");
      expect(pushSpy).not.toHaveBeenCalled();
    });
  });

  describe("hasDashboardParam", () => {
    it('HASPARAM-114: returns true for "?dashboard=12"', () => {
      expect(hasDashboardParam("?dashboard=12")).toBe(true);
    });

    it("HASPARAM-114: reports a junk param as present even though it does not parse to an id", () => {
      expect(hasDashboardParam("?dashboard=abc")).toBe(true);
      expect(readDashboardIdFromSearch("?dashboard=abc")).toBeNull();
    });

    it('HASPARAM-114: returns true for "?dashboard=" (present, empty value)', () => {
      expect(hasDashboardParam("?dashboard=")).toBe(true);
    });

    it('HASPARAM-114: returns false for "" (no query string at all)', () => {
      expect(hasDashboardParam("")).toBe(false);
    });

    it('HASPARAM-114: returns false for "?foo=1" (param absent)', () => {
      expect(hasDashboardParam("?foo=1")).toBe(false);
    });
  });

  // Phase 117 (DSET-V122-01/02/06/08): mode-aware coverage, the bare-URL regression guard, and
  // the accepted ?mode= namespace collision with lib/tableUrl.ts. Mirrors lib/tableUrl.spec.ts's
  // shapes; does NOT import anything from lib/tableUrl.ts (the collision test uses raw query
  // strings only — the tables files are off-limits per 117-RESEARCH §Q1 "keep duplicated").
  describe("readDashboardModeFromSearch", () => {
    it("DSET-117: absent mode param -> \"open\"", () => {
      expect(readDashboardModeFromSearch("")).toBe("open");
    });

    it('DSET-117: "?mode=view" -> "view"', () => {
      expect(readDashboardModeFromSearch("?mode=view")).toBe("view");
    });

    it('DSET-117: "?mode=edit" -> "edit"', () => {
      expect(readDashboardModeFromSearch("?mode=edit")).toBe("edit");
    });

    it('DSET-117: "?mode=banana" -> "open", no throw (unrecognised falls back)', () => {
      expect(() => readDashboardModeFromSearch("?mode=banana")).not.toThrow();
      expect(readDashboardModeFromSearch("?mode=banana")).toBe("open");
    });

    it('DSET-117: "?mode=EDIT" -> "open" (exact match only, no lowercasing/trimming)', () => {
      expect(readDashboardModeFromSearch("?mode=EDIT")).toBe("open");
    });

    it('DSET-117: "?mode=" (empty value) -> "open"', () => {
      expect(readDashboardModeFromSearch("?mode=")).toBe("open");
    });
  });

  describe("buildDashboardUrl — mode-aware", () => {
    it("DSET-117: (loc, 12) with NO third argument -> \"/?dashboard=12\" — the bare URL is byte-identical (DSET-V122-08)", () => {
      expect(buildDashboardUrl({ pathname: "/", search: "", hash: "" }, 12)).toBe("/?dashboard=12");
    });

    it('DSET-117: (loc, 12, "open") -> "/?dashboard=12" — open is expressed by ABSENCE', () => {
      expect(buildDashboardUrl({ pathname: "/", search: "", hash: "" }, 12, "open")).toBe("/?dashboard=12");
    });

    it('DSET-117: (loc, 12, "view") -> "/?dashboard=12&mode=view"', () => {
      expect(buildDashboardUrl({ pathname: "/", search: "", hash: "" }, 12, "view")).toBe("/?dashboard=12&mode=view");
    });

    it('DSET-117: (loc, 12, "edit") -> "/?dashboard=12&mode=edit"', () => {
      expect(buildDashboardUrl({ pathname: "/", search: "", hash: "" }, 12, "edit")).toBe("/?dashboard=12&mode=edit");
    });

    it('DSET-117: (loc with "?dashboard=9&mode=edit", null) -> both params removed', () => {
      expect(buildDashboardUrl({ pathname: "/", search: "?dashboard=9&mode=edit", hash: "" }, null)).toBe("/");
    });

    it("DSET-117: an unrelated param and the hash survive a mode write", () => {
      expect(buildDashboardUrl({ pathname: "/", search: "?a=1", hash: "#x" }, 7, "edit")).toBe("/?a=1&dashboard=7&mode=edit#x");
    });
  });

  describe("openDashboardUrl / restoreDashboardUrl — mode-aware", () => {
    // NOTE: these assert "pushes exactly ONE entry" via a pushState call-count spy rather than a
    // raw window.history.length delta. A raw length delta is NOT a reliable signal in this file:
    // an earlier test's leaveDashboardUrl() "popped" branch leaves the session-history POSITION
    // behind the stack's top (jsdom's back() moves the pointer but does not delete the now-dangling
    // forward entry), so the NEXT pushState call truncates that stale forward entry and adds one —
    // a net length delta of 0, not +1 — even though exactly one NEW entry was genuinely pushed.
    // Spying on the call itself is robust to this ordering artifact and verifies the same claim
    // more precisely (call count, not stack arithmetic that depends on prior tests' traversal state).
    it("DSET-117: openDashboardUrl(12) with ONE argument -> search \"?dashboard=12\", marker true, pushes exactly ONE entry (DSET-V122-08)", () => {
      const pushSpy = vi.spyOn(window.history, "pushState");
      openDashboardUrl(12);
      expect(window.location.search).toBe("?dashboard=12");
      expect((window.history.state as Record<string, unknown>)[DASHBOARD_HISTORY_MARKER]).toBe(true);
      expect(pushSpy).toHaveBeenCalledTimes(1);
      pushSpy.mockRestore();
    });

    it('DSET-117: openDashboardUrl(12, "view") -> "?dashboard=12&mode=view", marker true, pushes exactly ONE entry', () => {
      const pushSpy = vi.spyOn(window.history, "pushState");
      openDashboardUrl(12, "view");
      expect(window.location.search).toBe("?dashboard=12&mode=view");
      expect((window.history.state as Record<string, unknown>)[DASHBOARD_HISTORY_MARKER]).toBe(true);
      expect(pushSpy).toHaveBeenCalledTimes(1);
      pushSpy.mockRestore();
    });

    it('DSET-117: openDashboardUrl(12, "edit") -> "?dashboard=12&mode=edit", marker true, pushes exactly ONE entry', () => {
      const pushSpy = vi.spyOn(window.history, "pushState");
      openDashboardUrl(12, "edit");
      expect(window.location.search).toBe("?dashboard=12&mode=edit");
      expect((window.history.state as Record<string, unknown>)[DASHBOARD_HISTORY_MARKER]).toBe(true);
      expect(pushSpy).toHaveBeenCalledTimes(1);
      pushSpy.mockRestore();
    });

    it('DSET-117: restoreDashboardUrl(12) -> "?dashboard=12", history.length UNCHANGED', () => {
      const lengthBefore = window.history.length;
      restoreDashboardUrl(12);
      expect(window.location.search).toBe("?dashboard=12");
      expect(window.history.length).toBe(lengthBefore);
    });

    it('DSET-117: restoreDashboardUrl(12, "edit") -> "?dashboard=12&mode=edit", history.length UNCHANGED', () => {
      const lengthBefore = window.history.length;
      restoreDashboardUrl(12, "edit");
      expect(window.location.search).toBe("?dashboard=12&mode=edit");
      expect(window.history.length).toBe(lengthBefore);
    });
  });

  describe("setDashboardMode", () => {
    // Pitfall 1: a test that only exercises the self-opened path (marker always true) will not
    // catch a hardcoded-marker bug, and one that only exercises the arrived path will not catch
    // a hardcoded-null bug. Both directions below are mandatory, and they must fail on DIFFERENT
    // tests (mutation probes B and C, Task 2 acceptance criteria 6-7).

    it('DSET-117: view -> edit rewrites the bar and does NOT change history.length', () => {
      openDashboardUrl(12, "view");
      const lengthBefore = window.history.length;
      setDashboardMode(12, "edit");
      expect(window.location.search).toBe("?dashboard=12&mode=edit");
      expect(window.history.length).toBe(lengthBefore);
    });

    it('DSET-117: edit -> view rewrites the bar and does NOT change history.length', () => {
      openDashboardUrl(12, "edit");
      const lengthBefore = window.history.length;
      setDashboardMode(12, "view");
      expect(window.location.search).toBe("?dashboard=12&mode=view");
      expect(window.history.length).toBe(lengthBefore);
    });

    it("DSET-117: on an entry pushed by openDashboardUrl, the marker is STILL true afterwards (self-opened stays poppable)", () => {
      openDashboardUrl(12, "view");
      setDashboardMode(12, "edit");
      expect((window.history.state as Record<string, unknown> | null ?? {})[DASHBOARD_HISTORY_MARKER]).toBe(true);
    });

    it("DSET-117: on an unmarked entry seeded with replaceState(null, ...), history.state stays unmarked afterwards (an arrival is never turned into a popper)", () => {
      window.history.replaceState(null, "", "/?dashboard=12&mode=edit");
      setDashboardMode(12, "view");
      const state = (window.history.state as Record<string, unknown> | null) ?? {};
      expect(state[DASHBOARD_HISTORY_MARKER]).not.toBe(true);
    });

    it('DSET-117: leaveDashboardUrl() after setDashboardMode on a self-opened entry returns "popped"; after one on an unmarked entry returns "wrote"', async () => {
      // Self-opened direction.
      openDashboardUrl(12, "view");
      setDashboardMode(12, "edit");
      const pushSpy = vi.spyOn(window.history, "pushState");
      const poppedResult = leaveDashboardUrl();
      expect(poppedResult).toBe("popped");
      pushSpy.mockRestore();
      await waitFor(() => expect(window.location.search).toBe(""));

      // Arrived (unmarked) direction.
      window.history.replaceState(null, "", "/?dashboard=12&mode=edit");
      setDashboardMode(12, "view");
      const backSpy = vi.spyOn(window.history, "back");
      const wroteResult = leaveDashboardUrl();
      expect(wroteResult).toBe("wrote");
      expect(backSpy).not.toHaveBeenCalled();
      backSpy.mockRestore();
    });
  });

  describe("clearDashboardUrl + the accepted ?mode= collision", () => {
    it('DSET-117: clearDashboardUrl() on "?dashboard=12&mode=edit" leaves search ""', () => {
      window.history.replaceState(null, "", "/?dashboard=12&mode=edit");
      clearDashboardUrl();
      expect(window.location.search).toBe("");
    });

    it("DSET-117: RECORDED COLLISION — clearDashboardUrl also strips a hand-crafted table's ?mode= (accepted, no UI path)", () => {
      // No UI path produces "?dashboard=5&table=12&mode=edit" (dashboard-wins precedence in
      // App.tsx means only one entity ever drives navigation) — this is a hand-crafted-URL-only
      // edge case, pinned here so a future reader sees it was noticed, not missed. Raw query
      // string only; lib/tableUrl.ts is not imported by this file (117-RESEARCH §Q1).
      window.history.replaceState(null, "", "/?dashboard=5&table=12&mode=edit");
      clearDashboardUrl();
      expect(window.location.search).toBe("?table=12");
    });
  });

  describe("DASHBOARD_MODE_PARAM", () => {
    it('DSET-117: DASHBOARD_MODE_PARAM === "mode" — the SAME literal key lib/tableUrl.ts\'s TABLE_MODE_PARAM uses (accepted collision)', () => {
      expect(DASHBOARD_MODE_PARAM).toBe("mode");
    });
  });
});
