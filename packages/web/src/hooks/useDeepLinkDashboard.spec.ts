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

describe("useDeepLinkDashboard — storedDashboard parameter (Phase 115, AUTHLINK-115)", () => {
  it("AUTHLINK-115: stored dashboard 12 on a bare URL + authenticated + list contains 12 -> opened", async () => {
    window.history.replaceState(null, "", "/");
    useAuthStore.setState({ status: "authenticated" });
    const dashboard12 = makeDashboard(12);
    listDashboardsMock.mockResolvedValue([dashboard12]);

    const { result } = renderHook(() => useDeepLinkDashboard({ id: 12, mode: "open" }));

    expect(result.current.status).toBe("pending");
    await waitFor(() => expect(result.current.status).toBe("opened"));
    expect((result.current as Extract<DeepLinkState, { status: "opened" }>).dashboard).toEqual(dashboard12);
  });

  it("AUTHLINK-115: stored dashboard 12 with auth status unknown at boot stays pending until authenticated, then resolves", async () => {
    window.history.replaceState(null, "", "/");
    useAuthStore.setState({ status: "unknown" });
    const dashboard12 = makeDashboard(12);
    listDashboardsMock.mockResolvedValue([dashboard12]);

    const { result } = renderHook(() => useDeepLinkDashboard({ id: 12, mode: "open" }));

    expect(result.current.status).toBe("pending");
    expect(listDashboardsMock).not.toHaveBeenCalled();

    act(() => {
      useAuthStore.setState({ status: "authenticated" });
    });

    await waitFor(() => expect(result.current.status).toBe("opened"));
  });

  it("AUTHLINK-115: URL \"?dashboard=7\" beats stored dashboard 12 -> resolves 7, not 12", async () => {
    window.history.replaceState(null, "", "/?dashboard=7");
    useAuthStore.setState({ status: "authenticated" });
    const dashboard7 = makeDashboard(7);
    listDashboardsMock.mockResolvedValue([dashboard7]);

    const { result } = renderHook(() => useDeepLinkDashboard({ id: 12, mode: "open" }));

    await waitFor(() => expect(result.current.status).toBe("opened"));
    expect((result.current as Extract<DeepLinkState, { status: "opened" }>).dashboard).toEqual(dashboard7);
  });

  it("AUTHLINK-115: stored dashboard null/undefined/absent on a bare URL -> none, listDashboards never called", () => {
    window.history.replaceState(null, "", "/");
    useAuthStore.setState({ status: "authenticated" });

    const { result: resultNull } = renderHook(() => useDeepLinkDashboard(null));
    expect(resultNull.current.status).toBe("none");

    const { result: resultUndefined } = renderHook(() => useDeepLinkDashboard(undefined));
    expect(resultUndefined.current.status).toBe("none");

    const { result: resultAbsent } = renderHook(() => useDeepLinkDashboard());
    expect(resultAbsent.current.status).toBe("none");

    expect(listDashboardsMock).not.toHaveBeenCalled();
  });

  it("AUTHLINK-115: invalid stored dashboard id shapes (0, -3, 1.5, \"12\") on a bare URL -> none, listDashboards never called", () => {
    window.history.replaceState(null, "", "/");
    useAuthStore.setState({ status: "authenticated" });

    for (const bad of [0, -3, 1.5, "12" as unknown as number]) {
      const { result } = renderHook(() => useDeepLinkDashboard({ id: bad, mode: "open" }));
      expect(result.current.status).toBe("none");
    }

    expect(listDashboardsMock).not.toHaveBeenCalled();
  });

  it("AUTHLINK-115: a stored id resolves with exactly ONE listDashboards call under StrictMode", async () => {
    window.history.replaceState(null, "", "/");
    useAuthStore.setState({ status: "authenticated" });
    listDashboardsMock.mockResolvedValue([makeDashboard(12)]);

    const { result } = renderHook(() => useDeepLinkDashboard({ id: 12, mode: "open" }), {
      wrapper: ({ children }) => React.createElement(React.StrictMode, null, children),
    });

    await waitFor(() => expect(result.current.status).toBe("opened"));
    expect(listDashboardsMock).toHaveBeenCalledTimes(1);
  });

  it("AUTHLINK-115: URL \"?dashboard=abc\" (junk) is stripped AND the stored 12 still resolves", async () => {
    window.history.replaceState(null, "", "/?dashboard=abc");
    useAuthStore.setState({ status: "authenticated" });
    listDashboardsMock.mockResolvedValue([makeDashboard(12)]);

    const { result } = renderHook(() => useDeepLinkDashboard({ id: 12, mode: "open" }));

    expect(window.location.search).toBe("");
    await waitFor(() => expect(result.current.status).toBe("opened"));
    expect((result.current as Extract<DeepLinkState, { status: "opened" }>).dashboard.id).toBe(12);
  });
});

describe("useDeepLinkDashboard — mode resolution (Phase 117, DSET-117)", () => {
  it("DSET-117: ?dashboard=7 + authenticated + in the list -> opened with mode open, param left in place", async () => {
    window.history.replaceState(null, "", "/?dashboard=7");
    useAuthStore.setState({ status: "authenticated" });
    const dashboard7 = makeDashboard(7);
    listDashboardsMock.mockResolvedValue([dashboard7]);

    const { result } = renderHook(() => useDeepLinkDashboard());

    await waitFor(() => expect(result.current.status).toBe("opened"));
    const opened = result.current as Extract<DeepLinkState, { status: "opened" }>;
    expect(opened.mode).toBe("open");
    expect(window.location.search).toBe("?dashboard=7");
  });

  it("DSET-117: ?dashboard=7&mode=view -> opened with mode view, param left in place", async () => {
    window.history.replaceState(null, "", "/?dashboard=7&mode=view");
    useAuthStore.setState({ status: "authenticated" });
    const dashboard7 = makeDashboard(7);
    listDashboardsMock.mockResolvedValue([dashboard7]);

    const { result } = renderHook(() => useDeepLinkDashboard());

    await waitFor(() => expect(result.current.status).toBe("opened"));
    const opened = result.current as Extract<DeepLinkState, { status: "opened" }>;
    expect(opened.mode).toBe("view");
    expect(window.location.search).toBe("?dashboard=7&mode=view");
  });

  it("DSET-117: ?dashboard=7&mode=edit -> opened with mode edit, param left in place", async () => {
    window.history.replaceState(null, "", "/?dashboard=7&mode=edit");
    useAuthStore.setState({ status: "authenticated" });
    const dashboard7 = makeDashboard(7);
    listDashboardsMock.mockResolvedValue([dashboard7]);

    const { result } = renderHook(() => useDeepLinkDashboard());

    await waitFor(() => expect(result.current.status).toBe("opened"));
    const opened = result.current as Extract<DeepLinkState, { status: "opened" }>;
    expect(opened.mode).toBe("edit");
    expect(window.location.search).toBe("?dashboard=7&mode=edit");
  });

  it("DSET-117: ?dashboard=7&mode=banana -> opened with mode open, NOT unavailable and NOT error", async () => {
    window.history.replaceState(null, "", "/?dashboard=7&mode=banana");
    useAuthStore.setState({ status: "authenticated" });
    const dashboard7 = makeDashboard(7);
    listDashboardsMock.mockResolvedValue([dashboard7]);

    const { result } = renderHook(() => useDeepLinkDashboard());

    await waitFor(() => expect(result.current.status).toBe("opened"));
    const opened = result.current as Extract<DeepLinkState, { status: "opened" }>;
    expect(opened.mode).toBe("open");
  });

  it("DSET-117: ?dashboard=7&mode=EDIT -> opened with mode open (exact match only)", async () => {
    window.history.replaceState(null, "", "/?dashboard=7&mode=EDIT");
    useAuthStore.setState({ status: "authenticated" });
    const dashboard7 = makeDashboard(7);
    listDashboardsMock.mockResolvedValue([dashboard7]);

    const { result } = renderHook(() => useDeepLinkDashboard());

    await waitFor(() => expect(result.current.status).toBe("opened"));
    const opened = result.current as Extract<DeepLinkState, { status: "opened" }>;
    expect(opened.mode).toBe("open");
  });

  it("DSET-117: ?dashboard=99&mode=view absent from the list -> unavailable, BOTH params stripped", async () => {
    window.history.replaceState(null, "", "/?dashboard=99&mode=view");
    useAuthStore.setState({ status: "authenticated" });
    listDashboardsMock.mockResolvedValue([makeDashboard(7)]);

    const { result } = renderHook(() => useDeepLinkDashboard());

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(window.location.search).toBe("");
  });

  it("DSET-117: the unavailable message is the two-clause combined wording, naming neither a permission nor an id", () => {
    expect(DEEP_LINK_UNAVAILABLE_MESSAGE).toBe(
      "This dashboard isn't available — it may have been deleted, or you may not have access.",
    );
  });

  it("DSET-117: stored {id:12, mode:'edit'} on a BARE url -> opened with mode edit", async () => {
    window.history.replaceState(null, "", "/");
    useAuthStore.setState({ status: "authenticated" });
    const dashboard12 = makeDashboard(12);
    listDashboardsMock.mockResolvedValue([dashboard12]);

    const { result } = renderHook(() => useDeepLinkDashboard({ id: 12, mode: "edit" }));

    await waitFor(() => expect(result.current.status).toBe("opened"));
    const opened = result.current as Extract<DeepLinkState, { status: "opened" }>;
    expect(opened.dashboard.id).toBe(12);
    expect(opened.mode).toBe("edit");
  });

  it("DSET-117: stored {id:12, mode:'view'} on ?dashboard=7&mode=edit -> resolves id 7 in mode edit (URL beats storage for the mode too)", async () => {
    window.history.replaceState(null, "", "/?dashboard=7&mode=edit");
    useAuthStore.setState({ status: "authenticated" });
    const dashboard7 = makeDashboard(7);
    listDashboardsMock.mockResolvedValue([dashboard7]);

    const { result } = renderHook(() => useDeepLinkDashboard({ id: 12, mode: "view" }));

    await waitFor(() => expect(result.current.status).toBe("opened"));
    const opened = result.current as Extract<DeepLinkState, { status: "opened" }>;
    expect(opened.dashboard.id).toBe(7);
    expect(opened.mode).toBe("edit");
  });

  it("DSET-117: stored null on a bare url -> none, listDashboards never called", () => {
    window.history.replaceState(null, "", "/");
    useAuthStore.setState({ status: "authenticated" });

    const { result } = renderHook(() => useDeepLinkDashboard(null));

    expect(result.current.status).toBe("none");
    expect(listDashboardsMock).not.toHaveBeenCalled();
  });

  it("DSET-117: ?dashboard=7&mode=edit still calls listDashboards exactly once under StrictMode", async () => {
    window.history.replaceState(null, "", "/?dashboard=7&mode=edit");
    useAuthStore.setState({ status: "authenticated" });
    listDashboardsMock.mockResolvedValue([makeDashboard(7)]);

    const { result } = renderHook(() => useDeepLinkDashboard(), {
      wrapper: ({ children }) => React.createElement(React.StrictMode, null, children),
    });

    await waitFor(() => expect(result.current.status).toBe("opened"));
    expect(listDashboardsMock).toHaveBeenCalledTimes(1);
  });

  it("DSET-117: a rejection arriving after the session ends stays pending with the mode intact and the param surviving", async () => {
    window.history.replaceState(null, "", "/?dashboard=7&mode=edit");
    useAuthStore.setState({ status: "authenticated" });
    let rejectFn!: (err: unknown) => void;
    listDashboardsMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectFn = reject;
      }),
    );

    const { result } = renderHook(() => useDeepLinkDashboard());
    expect(result.current.status).toBe("pending");
    expect((result.current as Extract<DeepLinkState, { status: "pending" }>).mode).toBe("edit");

    act(() => {
      useAuthStore.setState({ status: "unauthenticated" });
    });

    await act(async () => {
      rejectFn(new Error("401"));
      await Promise.resolve();
    });

    expect(result.current.status).toBe("pending");
    expect((result.current as Extract<DeepLinkState, { status: "pending" }>).mode).toBe("edit");
    expect(window.location.search).toBe("?dashboard=7&mode=edit");
  });
});
