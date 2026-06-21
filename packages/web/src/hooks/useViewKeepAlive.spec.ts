/**
 * Phase 78 (TTLKEEP-V115-01): tests for useViewKeepAlive hook.
 *
 * Uses vitest fake timers (vi.useFakeTimers / vi.setSystemTime / renderHook) to exercise:
 *   - First-touch scheduling ~leadMs before expiresAt
 *   - Touch is a READ (runSql SELECT 1), not a materialize
 *   - Re-arm across >1 window on a stable W-based interval
 *   - Both filter-view AND dynamic-view are touched
 *   - Teardown aborts in-flight controllers and clears timers on unmount
 *   - Disappeared-view re-sync (timer cleared, controller aborted)
 *   - expiresAt===0 placeholder filter-views are skipped
 *   - Static-import guard: no materializeFilter/materializeDynamicView/dropFilterView/fromSwap
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useViewKeepAlive } from "./useViewKeepAlive";
import { useFilterViewStore } from "../store/filterViewStore";
import { useDynamicViewStore } from "../store/dynamicViewStore";
import { useAuthStore } from "../store/auth";

// Mock runSql from client.ts so we can assert calls without network
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    runSql: vi.fn().mockResolvedValue({}),
  };
});

// Import the mocked runSql for assertion
import { runSql } from "../api/client";
const runSqlMock = runSql as ReturnType<typeof vi.fn>;

const DASHBOARD_ID = 1;
const LEAD_MINUTES = 1;
const LEAD_MS = LEAD_MINUTES * 60_000; // 60_000ms
const MIN_DELAY = 1_000;
const MIN_INTERVAL = 30_000;

beforeEach(() => {
  vi.useFakeTimers();
  // Stores under src/store/ are auto-reset by the Zustand reset shim in __mocks__/zustand.ts.
  // Set lead-time here for clarity.
  useAuthStore.setState({ ttlKeepaliveLeadMinutes: LEAD_MINUTES });
  runSqlMock.mockClear();
  runSqlMock.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Seed a live filter-view at the given tableId with expiresAt = now + ttlMs. */
function seedFilterView(tableId: number, ttlMs: number, viewName?: string): void {
  const now = Date.now();
  useFilterViewStore.setState((s) => ({
    views: {
      ...s.views,
      [tableId]: {
        viewName: viewName ?? `filter_view_${tableId}`,
        expiresAt: now + ttlMs,
        materializing: false,
        materializeVersion: 1,
        dashboardId: DASHBOARD_ID,
      },
    },
  }));
}

/** Seed a live materialized dynamic-view at the given id with expiresAt = now + ttlMs. */
function seedDynamicView(dvId: number, ttlMs: number, viewName?: string): void {
  const now = Date.now();
  useDynamicViewStore.setState((s) => ({
    views: {
      ...s.views,
      [dvId]: {
        viewName: viewName ?? `dv_view_${dvId}`,
        status: "materialized" as const,
        expiresAt: now + ttlMs,
      },
    },
  }));
}

describe("useViewKeepAlive", () => {
  it("schedules first touch ~leadMs before expiresAt", async () => {
    // expiresAt = now + 5min; lead = 1min → firstDelay = 4min
    const ttlMs = 5 * 60_000;
    const now = Date.now();
    vi.setSystemTime(now);
    seedFilterView(42, ttlMs, "my_filter_view");

    const { unmount } = renderHook(() => useViewKeepAlive(DASHBOARD_ID));

    // Not yet fired
    expect(runSqlMock).not.toHaveBeenCalled();

    // Advance to just before the 4-minute mark (firstDelay = 5min - 1min = 4min)
    await act(async () => {
      vi.advanceTimersByTime(4 * 60_000 - 1);
    });
    expect(runSqlMock).not.toHaveBeenCalled();

    // Advance past the 4-minute mark → first touch fires
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(runSqlMock).toHaveBeenCalledOnce();
    expect(runSqlMock.mock.calls[0][0]).toMatch(/SELECT 1 FROM .* LIMIT 1/);

    unmount();
  });

  it("touch issues a runSql READ not a materialize", async () => {
    const ttlMs = 5 * 60_000;
    vi.setSystemTime(Date.now());
    seedFilterView(43, ttlMs, "read_test_view");

    const { unmount } = renderHook(() => useViewKeepAlive(DASHBOARD_ID));

    // Advance to fire the first touch
    await act(async () => {
      vi.advanceTimersByTime(4 * 60_000 + 1);
    });

    expect(runSqlMock).toHaveBeenCalled();
    // The SQL must be a SELECT 1 FROM ... LIMIT 1 READ — not a materialize call
    const sql: string = runSqlMock.mock.calls[0][0];
    expect(sql).toMatch(/^SELECT 1 FROM .+ LIMIT 1$/);

    unmount();
  });

  it("re-arms a subsequent touch after the interval (across >1 window)", async () => {
    // W ≈ 5min; reArmInterval = max(5min - 1min, 30s) = 4min
    const ttlMs = 5 * 60_000;
    vi.setSystemTime(Date.now());
    seedFilterView(44, ttlMs, "rearm_view");

    const reArmInterval = Math.max(ttlMs - LEAD_MS, MIN_INTERVAL); // 4min

    const { unmount } = renderHook(() => useViewKeepAlive(DASHBOARD_ID));

    // Fire FIRST touch (at firstDelay = 4min)
    await act(async () => {
      vi.advanceTimersByTime(4 * 60_000 + 1);
    });
    expect(runSqlMock).toHaveBeenCalledTimes(1);

    // Advance by reArmInterval → SECOND touch
    await act(async () => {
      vi.advanceTimersByTime(reArmInterval + 1);
    });
    expect(runSqlMock).toHaveBeenCalledTimes(2);

    // Advance another reArmInterval → THIRD touch (proves stable re-arm across >1 window)
    await act(async () => {
      vi.advanceTimersByTime(reArmInterval + 1);
    });
    expect(runSqlMock).toHaveBeenCalledTimes(3);

    unmount();
  });

  it("touches BOTH a filter-view and a dynamic-view", async () => {
    const ttlMs = 5 * 60_000;
    vi.setSystemTime(Date.now());
    seedFilterView(45, ttlMs, "filter_view_both");
    seedDynamicView(100, ttlMs, "dv_view_both");

    const { unmount } = renderHook(() => useViewKeepAlive(DASHBOARD_ID));

    // Advance past firstDelay (4min) for both views
    await act(async () => {
      vi.advanceTimersByTime(4 * 60_000 + 1);
    });

    // Both views should have been touched
    expect(runSqlMock).toHaveBeenCalledTimes(2);
    const calls = runSqlMock.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((sql) => sql.includes("filter_view_both"))).toBe(true);
    expect(calls.some((sql) => sql.includes("dv_view_both"))).toBe(true);

    unmount();
  });

  it("clears timers and aborts in-flight controllers on unmount", async () => {
    const ttlMs = 5 * 60_000;
    vi.setSystemTime(Date.now());

    // Make runSql return a never-resolving promise but capture the AbortSignal
    let capturedSignal: AbortSignal | undefined;
    runSqlMock.mockImplementation(
      (_sql: string, _opts: unknown, signal?: AbortSignal) => {
        capturedSignal = signal;
        return new Promise(() => {}); // never resolves
      },
    );

    seedFilterView(46, ttlMs, "inflight_view");

    const { unmount } = renderHook(() => useViewKeepAlive(DASHBOARD_ID));

    // Advance to fire the first touch (in-flight)
    await act(async () => {
      vi.advanceTimersByTime(4 * 60_000 + 1);
    });
    expect(runSqlMock).toHaveBeenCalledOnce();
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    // Unmount → all controllers should be aborted
    await act(async () => {
      unmount();
    });
    expect(capturedSignal!.aborted).toBe(true);

    // Advancing timers further should fire NO additional runSql calls
    const callsBeforeAdvance = runSqlMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(runSqlMock.mock.calls.length).toBe(callsBeforeAdvance);
  });

  it("re-syncs when a view disappears (timer cleared, controller aborted)", async () => {
    const ttlMs = 5 * 60_000;
    vi.setSystemTime(Date.now());

    // Capture the AbortSignal for the scheduled timer's controller
    let capturedSignal: AbortSignal | undefined;
    runSqlMock.mockImplementation(
      (_sql: string, _opts: unknown, signal?: AbortSignal) => {
        capturedSignal = signal;
        return Promise.resolve({});
      },
    );

    seedFilterView(47, ttlMs, "disappear_view");

    const { unmount, rerender } = renderHook(() => useViewKeepAlive(DASHBOARD_ID));

    // Verify a timer was set (hook is alive, view is live)
    expect(runSqlMock).not.toHaveBeenCalled();

    // Remove the view from the store (simulates view expiry / drop)
    await act(async () => {
      useFilterViewStore.getState().clearView(47);
    });

    // Re-render the hook so the filterKey recomputes and the re-sync effect fires
    rerender();

    // Now advance time past the original firstDelay — the timer should have been cleared
    await act(async () => {
      vi.advanceTimersByTime(4 * 60_000 + 1);
    });
    // The view was removed before the touch fired; if the timer was properly cleared,
    // runSql should NOT have been called with "disappear_view"
    const calls = runSqlMock.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.every((sql) => !sql.includes("disappear_view"))).toBe(true);
    // Signal was never in-flight for this view (touch never fired)
    expect(capturedSignal).toBeUndefined();

    unmount();
  });

  it("skips expiresAt===0 placeholder filter-views", async () => {
    vi.setSystemTime(Date.now());

    // markMaterializing creates a placeholder with expiresAt: 0
    useFilterViewStore.getState().markMaterializing(48, DASHBOARD_ID);

    const { unmount } = renderHook(() => useViewKeepAlive(DASHBOARD_ID));

    // Advance a generous amount — nothing should fire (expiresAt=0 is skipped)
    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(runSqlMock).not.toHaveBeenCalled();

    unmount();
  });

  it("does NOT import materializeFilter/materializeDynamicView/dropFilterView/fromSwap (sole-materialize-trigger invariant)", async () => {
    // Mirror DataFilterRenderer.spec.tsx:609-620: static-import assertion via file read
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const filePath = path.resolve(
      process.cwd(),
      "src/hooks/useViewKeepAlive.ts",
    );
    const source = await fs.readFile(filePath, "utf-8");
    expect(source).not.toMatch(/materializeFilter/);
    expect(source).not.toMatch(/materializeDynamicView/);
    expect(source).not.toMatch(/dropFilterView/);
    expect(source).not.toMatch(/fromSwap/);
  });
});
