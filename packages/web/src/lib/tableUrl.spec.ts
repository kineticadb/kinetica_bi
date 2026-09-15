/**
 * lib/tableUrl.spec.ts — Phase 116 Plan 01 Task 2 (TLINK-V121-01/06/07).
 *
 * Direct unit spec for the pure param read/build helpers plus the History-API writers
 * (openTableUrl / setTableMode / restoreTableUrl / clearTableUrl / leaveTableUrl), mirroring
 * lib/dashboardUrl.spec.ts's harness and technique, plus two behaviours with no dashboard
 * analogue: readTableModeFromSearch and setTableMode.
 *
 * jsdom DOES implement session-history traversal (pushState -> history.back() -> popstate really
 * fires and window.location.search really rolls back), but it is ASYNCHRONOUS — several
 * macrotask ticks later, not synchronously and not on the next microtask. Every assertion that
 * depends on a traversal is wrapped in waitFor; replaceState/pushState-only assertions are
 * synchronous.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import {
  TABLE_URL_PARAM,
  TABLE_MODE_PARAM,
  TABLE_HISTORY_MARKER,
  readTableIdFromSearch,
  readTableModeFromSearch,
  buildTableUrl,
  openTableUrl,
  leaveTableUrl,
  clearTableUrl,
  hasTableParam,
  isValidTableId,
  restoreTableUrl,
  setTableMode,
} from "./tableUrl";

describe("tableUrl", () => {
  beforeEach(() => {
    // Prevent history/location state leaking between tests or from another spec file
    // (this repo has a documented cross-file contamination history under parallel scheduling).
    window.history.replaceState(null, "", "/");
  });

  describe("TABLE_URL_PARAM / TABLE_MODE_PARAM / TABLE_HISTORY_MARKER", () => {
    it("TLINK-116: exposes the expected constant names", () => {
      expect(TABLE_URL_PARAM).toBe("table");
      expect(TABLE_MODE_PARAM).toBe("mode");
      expect(TABLE_HISTORY_MARKER).toBe("kbiTableEntry");
    });
  });

  describe("readTableIdFromSearch", () => {
    it('TLINK-116: returns null for ""', () => {
      expect(readTableIdFromSearch("")).toBeNull();
    });

    it('TLINK-116: returns null for "?foo=1"', () => {
      expect(readTableIdFromSearch("?foo=1")).toBeNull();
    });

    it('TLINK-116: returns null for "?table="', () => {
      expect(readTableIdFromSearch("?table=")).toBeNull();
    });

    it('TLINK-116: returns 12 for "?table=12"', () => {
      expect(readTableIdFromSearch("?table=12")).toBe(12);
    });

    it('TLINK-116: returns 12 for "table=12" (no leading ?)', () => {
      expect(readTableIdFromSearch("table=12")).toBe(12);
    });

    it('TLINK-116: returns 7 for "?a=1&table=7"', () => {
      expect(readTableIdFromSearch("?a=1&table=7")).toBe(7);
    });

    it('TLINK-116: returns null for "?table=12abc"', () => {
      expect(readTableIdFromSearch("?table=12abc")).toBeNull();
    });

    it('TLINK-116: returns null for "?table=1.5"', () => {
      expect(readTableIdFromSearch("?table=1.5")).toBeNull();
    });

    it('TLINK-116: returns null for "?table=-3"', () => {
      expect(readTableIdFromSearch("?table=-3")).toBeNull();
    });

    it('TLINK-116: returns null for "?table=0"', () => {
      expect(readTableIdFromSearch("?table=0")).toBeNull();
    });
  });

  describe("readTableModeFromSearch", () => {
    it('TLINK-116: "?table=12" resolves to view (mode absent)', () => {
      expect(readTableModeFromSearch("?table=12")).toBe("view");
    });

    it('TLINK-116: "?table=12&mode=view" resolves to view', () => {
      expect(readTableModeFromSearch("?table=12&mode=view")).toBe("view");
    });

    it('TLINK-116: "?table=12&mode=edit" resolves to edit', () => {
      expect(readTableModeFromSearch("?table=12&mode=edit")).toBe("edit");
    });

    it("TLINK-116: ?table=12&mode=banana resolves to view, not a failure", () => {
      expect(readTableModeFromSearch("?table=12&mode=banana")).toBe("view");
    });

    it('TLINK-116: "?table=12&mode=" (empty value) resolves to view', () => {
      expect(readTableModeFromSearch("?table=12&mode=")).toBe("view");
    });

    it('TLINK-116: "?table=12&mode=EDIT" resolves to view — exact-match only, no lowercasing', () => {
      expect(readTableModeFromSearch("?table=12&mode=EDIT")).toBe("view");
    });

    it('TLINK-116: "" resolves to view', () => {
      expect(readTableModeFromSearch("")).toBe("view");
    });
  });

  describe("buildTableUrl", () => {
    it("TLINK-116: (id=12, mode=view) on a bare path sets only the table param", () => {
      expect(buildTableUrl({ pathname: "/", search: "", hash: "" }, 12, "view")).toBe("/?table=12");
    });

    it("TLINK-116: (id=12, mode=edit) sets both params", () => {
      expect(buildTableUrl({ pathname: "/", search: "", hash: "" }, 12, "edit")).toBe(
        "/?table=12&mode=edit",
      );
    });

    it("TLINK-116: (id=null) removes both table and mode", () => {
      expect(buildTableUrl({ pathname: "/", search: "?table=12&mode=edit", hash: "" }, null)).toBe(
        "/",
      );
    });

    it("TLINK-116: preserves unrelated params and the hash", () => {
      expect(buildTableUrl({ pathname: "/", search: "?a=1", hash: "#x" }, 12, "edit")).toBe(
        "/?a=1&table=12&mode=edit#x",
      );
    });

    it("TLINK-116: replaces an existing table id rather than duplicating it", () => {
      expect(buildTableUrl({ pathname: "/", search: "?table=3", hash: "" }, 9, "view")).toBe(
        "/?table=9",
      );
    });

    it("TLINK-116: (id=12, mode=view) on a stale edit search drops the stale mode", () => {
      expect(buildTableUrl({ pathname: "/", search: "?table=9&mode=edit", hash: "" }, 12, "view")).toBe(
        "/?table=12",
      );
    });
  });

  describe("openTableUrl", () => {
    it("TLINK-116: pushes a marked entry with table+mode set for edit", () => {
      const lengthBefore = window.history.length;
      openTableUrl(12, "edit");
      expect(window.location.search).toBe("?table=12&mode=edit");
      expect((window.history.state as Record<string, unknown>)[TABLE_HISTORY_MARKER]).toBe(true);
      expect(window.history.length).toBe(lengthBefore + 1);
    });

    it("TLINK-116: pushes a marked entry with only table set for view", () => {
      const lengthBefore = window.history.length;
      openTableUrl(12, "view");
      expect(window.location.search).toBe("?table=12");
      expect((window.history.state as Record<string, unknown>)[TABLE_HISTORY_MARKER]).toBe(true);
      expect(window.history.length).toBe(lengthBefore + 1);
    });
  });

  describe("clearTableUrl", () => {
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

    it("TLINK-116: removes both params in place, without navigating or pushing", () => {
      window.history.replaceState(null, "", "/?table=12&mode=edit");
      const lengthBefore = window.history.length;
      clearTableUrl();
      expect(window.location.search).toBe("");
      expect(window.history.length).toBe(lengthBefore);
      expect(backSpy).not.toHaveBeenCalled();
      expect(pushSpy).not.toHaveBeenCalled();
    });

    it("TLINK-116: is idempotent when already clean", () => {
      clearTableUrl();
      expect(window.location.search).toBe("");
      expect(backSpy).not.toHaveBeenCalled();
      expect(pushSpy).not.toHaveBeenCalled();
    });

    it("TLINK-116: preserves unrelated params", () => {
      window.history.replaceState(null, "", "/?a=1&table=12&mode=edit");
      clearTableUrl();
      expect(window.location.search).toBe("?a=1");
    });
  });

  describe("restoreTableUrl", () => {
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

    it("TLINK-116: restoreTableUrl(7, edit) on / sets the search to ?table=7&mode=edit", () => {
      restoreTableUrl(7, "edit");
      expect(window.location.search).toBe("?table=7&mode=edit");
      expect(backSpy).not.toHaveBeenCalled();
      expect(pushSpy).not.toHaveBeenCalled();
    });

    it("TLINK-116: restoreTableUrl does NOT change history.length (replaceState, never pushState)", () => {
      const lengthBefore = window.history.length;
      restoreTableUrl(7, "view");
      expect(window.history.length).toBe(lengthBefore);
      expect(pushSpy).not.toHaveBeenCalled();
    });

    it("TLINK-116: restoreTableUrl preserves unrelated params", () => {
      window.history.replaceState(null, "", "/?a=1");
      restoreTableUrl(7, "view");
      expect(window.location.search).toBe("?a=1&table=7");
    });

    it("TLINK-116: restoreTableUrl is idempotent when the params already match", () => {
      window.history.replaceState(null, "", "/?table=7");
      restoreTableUrl(7, "view");
      expect(window.location.search).toBe("?table=7");
      expect(pushSpy).not.toHaveBeenCalled();
    });
  });

  describe("setTableMode", () => {
    // 116-RESEARCH Pitfall 3: a test that only exercises the self-opened path (marker always
    // true) will not catch a hardcoded-marker bug. Both paths below are mandatory.

    it("TLINK-116: setTableMode on a SELF-OPENED entry preserves the marker — leaveTableUrl still pops", async () => {
      openTableUrl(12, "edit");
      const lengthBefore = window.history.length;
      setTableMode(12, "view");
      expect(window.location.search).toBe("?table=12");
      expect(window.history.length).toBe(lengthBefore); // replaceState, not pushState

      const pushSpy = vi.spyOn(window.history, "pushState");
      const result = leaveTableUrl();
      expect(result).toBe("popped");
      pushSpy.mockRestore();
      await waitFor(() => expect(window.location.search).toBe(""));
    });

    it("TLINK-116: setTableMode on an ARRIVED-on entry leaves leaveTableUrl in its write branch", () => {
      // Exactly what a deep-link arrival looks like: an unmarked entry.
      window.history.replaceState(null, "", "/?table=12&mode=edit");
      setTableMode(12, "view");
      expect(window.location.search).toBe("?table=12");

      const backSpy = vi.spyOn(window.history, "back");
      const result = leaveTableUrl();
      expect(result).toBe("wrote");
      expect(window.location.search).toBe("");
      expect(backSpy).not.toHaveBeenCalled();
      backSpy.mockRestore();
    });
  });

  describe("leaveTableUrl", () => {
    it("TLINK-116: pops the pushed entry when we own the current one (popped branch)", async () => {
      openTableUrl(12, "view");
      const pushSpy = vi.spyOn(window.history, "pushState");
      const result = leaveTableUrl();
      expect(result).toBe("popped");
      expect(pushSpy).not.toHaveBeenCalled();
      // jsdom's back() traversal resolves several macrotask ticks later — this waitFor is
      // mandatory, not stylistic.
      await waitFor(() => expect(window.location.search).toBe(""));
      pushSpy.mockRestore();
    });

    it("TLINK-116: writes the list URL when there is no history entry to pop", () => {
      // Exactly what a deep-link arrival looks like: an unmarked entry.
      window.history.replaceState(null, "", "/?table=12");
      const backSpy = vi.spyOn(window.history, "back");
      const result = leaveTableUrl();
      expect(result).toBe("wrote");
      // This branch does no traversal, so a synchronous assertion is correct here.
      expect(window.location.search).toBe("");
      expect(backSpy).not.toHaveBeenCalled();
      backSpy.mockRestore();
    });
  });

  describe("isValidTableId", () => {
    it("TLINK-116: isValidTableId(12) === true", () => {
      expect(isValidTableId(12)).toBe(true);
    });

    it("TLINK-116: isValidTableId(0) === false", () => {
      expect(isValidTableId(0)).toBe(false);
    });

    it("TLINK-116: isValidTableId(-3) === false", () => {
      expect(isValidTableId(-3)).toBe(false);
    });

    it("TLINK-116: isValidTableId(1.5) === false", () => {
      expect(isValidTableId(1.5)).toBe(false);
    });

    it('TLINK-116: isValidTableId("12") === false — a string is NOT a valid id', () => {
      expect(isValidTableId("12")).toBe(false);
    });

    it("TLINK-116: isValidTableId(undefined) === false", () => {
      expect(isValidTableId(undefined)).toBe(false);
    });

    it("TLINK-116: isValidTableId(null) === false", () => {
      expect(isValidTableId(null)).toBe(false);
    });

    it("TLINK-116: isValidTableId(NaN) === false", () => {
      expect(isValidTableId(NaN)).toBe(false);
    });
  });

  describe("hasTableParam", () => {
    it('TLINK-116: returns true for "?table=12"', () => {
      expect(hasTableParam("?table=12")).toBe(true);
    });

    it("TLINK-116: reports a junk param as present even though it does not parse to an id", () => {
      expect(hasTableParam("?table=abc")).toBe(true);
      expect(readTableIdFromSearch("?table=abc")).toBeNull();
    });

    it('TLINK-116: returns true for "?table=" (present, empty value)', () => {
      expect(hasTableParam("?table=")).toBe(true);
    });

    it('TLINK-116: returns false for "" (no query string at all)', () => {
      expect(hasTableParam("")).toBe(false);
    });

    it('TLINK-116: returns false for "?foo=1" (param absent)', () => {
      expect(hasTableParam("?foo=1")).toBe(false);
    });
  });
});
