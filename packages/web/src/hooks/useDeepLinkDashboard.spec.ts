/**
 * hooks/useDeepLinkDashboard.spec.ts — Phase 114 Plan 01 (DLINK-V121-02/04/05).
 *
 * Direct unit spec for the boot-URL deep-link resolution state machine. Mocks
 * listDashboards (no network) and drives auth status via useAuthStore.setState.
 *
 * Every test title is prefixed "DEEPLINK-114: " (0 occurrences anywhere in src/ before
 * this file existed) so the anchor genuinely discriminates before/after this work.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  useDeepLinkDashboard,
  DEEP_LINK_UNAVAILABLE_MESSAGE,
  type DeepLinkState,
} from "./useDeepLinkDashboard";
import { useAuthStore } from "../store/auth";
import type { DashboardDto } from "../api/client";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    listDashboards: vi.fn(),
  };
});

import { listDashboards } from "../api/client";
const listDashboardsMock = listDashboards as ReturnType<typeof vi.fn>;

function makeDashboard(id: number): DashboardDto {
  return {
    id,
    name: `Dashboard ${id}`,
    filter_display_mode: "topbar",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  listDashboardsMock.mockReset();
  useAuthStore.setState({ status: "unknown" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDeepLinkDashboard", () => {
  it("DEEPLINK-114: no param at boot -> status none, listDashboards never called", () => {
    window.history.replaceState(null, "", "/");
    useAuthStore.setState({ status: "authenticated" });

    const { result } = renderHook(() => useDeepLinkDashboard());

    expect(result.current.status).toBe("none");
    expect(listDashboardsMock).not.toHaveBeenCalled();
  });

  it("DEEPLINK-114: ?dashboard=7 + authenticated + list contains it -> opened, param left in place", async () => {
    window.history.replaceState(null, "", "/?dashboard=7");
    useAuthStore.setState({ status: "authenticated" });
    const dashboard7 = makeDashboard(7);
    listDashboardsMock.mockResolvedValue([dashboard7]);

    const { result } = renderHook(() => useDeepLinkDashboard());

    expect(result.current.status).toBe("pending");

    await waitFor(() => expect(result.current.status).toBe("opened"));
    expect((result.current as Extract<DeepLinkState, { status: "opened" }>).dashboard).toEqual(dashboard7);
    expect(window.location.search).toBe("?dashboard=7");
  });

  it("DEEPLINK-114: ?dashboard=99 absent from the list -> unavailable, param stripped", async () => {
    window.history.replaceState(null, "", "/?dashboard=99");
    useAuthStore.setState({ status: "authenticated" });
    listDashboardsMock.mockResolvedValue([makeDashboard(7)]);

    const { result } = renderHook(() => useDeepLinkDashboard());

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(window.location.search).toBe("");
  });

  it("DEEPLINK-114: listDashboards rejects while authenticated -> error, param stripped", async () => {
    window.history.replaceState(null, "", "/?dashboard=7");
    useAuthStore.setState({ status: "authenticated" });
    listDashboardsMock.mockRejectedValue(new Error("500"));

    const { result } = renderHook(() => useDeepLinkDashboard());

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(window.location.search).toBe("");
  });

  it("DEEPLINK-114: rejection arriving after the session ends stays pending, param survives", async () => {
    window.history.replaceState(null, "", "/?dashboard=7");
    useAuthStore.setState({ status: "authenticated" });
    let rejectFn!: (err: unknown) => void;
    listDashboardsMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectFn = reject;
      }),
    );

    const { result } = renderHook(() => useDeepLinkDashboard());
    expect(result.current.status).toBe("pending");

    act(() => {
      useAuthStore.setState({ status: "unauthenticated" });
    });

    await act(async () => {
      rejectFn(new Error("401"));
      // let the rejection's microtask settle
      await Promise.resolve();
    });

    expect(result.current.status).toBe("pending");
    expect(window.location.search).toBe("?dashboard=7");
  });

  it('DEEPLINK-114: ?dashboard=abc (junk) -> none, param stripped, listDashboards not called', () => {
    window.history.replaceState(null, "", "/?dashboard=abc");
    useAuthStore.setState({ status: "authenticated" });

    const { result } = renderHook(() => useDeepLinkDashboard());

    expect(result.current.status).toBe("none");
    expect(window.location.search).toBe("");
    expect(listDashboardsMock).not.toHaveBeenCalled();
  });

  it("DEEPLINK-114: auth status unknown at boot stays pending until authenticated, then resolves", async () => {
    window.history.replaceState(null, "", "/?dashboard=7");
    useAuthStore.setState({ status: "unknown" });
    const dashboard7 = makeDashboard(7);
    listDashboardsMock.mockResolvedValue([dashboard7]);

    const { result } = renderHook(() => useDeepLinkDashboard());

    expect(result.current.status).toBe("pending");
    expect(listDashboardsMock).not.toHaveBeenCalled();

    act(() => {
      useAuthStore.setState({ status: "authenticated" });
    });

    await waitFor(() => expect(result.current.status).toBe("opened"));
  });

  it("DEEPLINK-114: StrictMode double-invoke still calls listDashboards exactly once", async () => {
    window.history.replaceState(null, "", "/?dashboard=7");
    useAuthStore.setState({ status: "authenticated" });
    listDashboardsMock.mockResolvedValue([makeDashboard(7)]);

    const { result } = renderHook(() => useDeepLinkDashboard(), {
      wrapper: ({ children }) => React.createElement(React.StrictMode, null, children),
    });

    await waitFor(() => expect(result.current.status).toBe("opened"));
    expect(listDashboardsMock).toHaveBeenCalledTimes(1);
  });

  it("DEEPLINK-114: exposes the single combined non-leaking message constant", () => {
    expect(DEEP_LINK_UNAVAILABLE_MESSAGE.length).toBeGreaterThan(0);
    expect(DEEP_LINK_UNAVAILABLE_MESSAGE.toLowerCase()).not.toMatch(/deleted\b.*only|not permitted\b.*only/);
  });
});
