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
  readDashboardIdFromSearch,
  buildDashboardUrl,
  openDashboardUrl,
  leaveDashboardUrl,
  clearDashboardUrl,
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
});
