/**
 * hooks/useDeepLinkTable.spec.ts — Phase 116 Plan 02 (TLINK-V121-02/04/07).
 *
 * Direct unit spec for the table boot-URL deep-link resolution state machine. Mocks
 * listTables (no network) and drives auth status via useAuthStore.setState. Mirrors
 * hooks/useDeepLinkDashboard.spec.ts's harness exactly (same renderHook import, same
 * vi.mock("../api/client") partial-mock shape, same beforeEach history/auth reset).
 *
 * Every test title is prefixed "TLINK-116: " (0 occurrences anywhere in src/ before this file
 * existed, outside lib/tableUrl.spec.ts from Plan 01 — this file's count is independently
 * meaningful) so the anchor genuinely discriminates before/after this work.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  useDeepLinkTable,
  DEEP_LINK_TABLE_UNAVAILABLE_MESSAGE,
  type DeepLinkTableState,
} from "./useDeepLinkTable";
import { useAuthStore } from "../store/auth";
import type { TableDto } from "../api/client";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    listTables: vi.fn(),
  };
});

import { listTables } from "../api/client";
const listTablesMock = listTables as ReturnType<typeof vi.fn>;

function makeTable(id: number): TableDto {
  return {
    id,
    name: `Table ${id}`,
    schema: "public",
    columns: { id: "integer" },
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  listTablesMock.mockReset();
  useAuthStore.setState({ status: "unknown" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDeepLinkTable", () => {
  it("TLINK-116: no param at boot -> status none, listTables never called", () => {
    window.history.replaceState(null, "", "/");
    useAuthStore.setState({ status: "authenticated" });

    const { result } = renderHook(() => useDeepLinkTable());

    expect(result.current.status).toBe("none");
    expect(listTablesMock).not.toHaveBeenCalled();
  });

  it("TLINK-116: ?table=7 + authenticated + list contains it -> opened in view mode, param left in place", async () => {
    window.history.replaceState(null, "", "/?table=7");
    useAuthStore.setState({ status: "authenticated" });
    const table7 = makeTable(7);
    listTablesMock.mockResolvedValue([table7]);

    const { result } = renderHook(() => useDeepLinkTable());

    expect(result.current.status).toBe("pending");

    await waitFor(() => expect(result.current.status).toBe("opened"));
    const opened = result.current as Extract<DeepLinkTableState, { status: "opened" }>;
    expect(opened.table).toEqual(table7);
    expect(opened.mode).toBe("view");
    expect(window.location.search).toBe("?table=7");
  });

  it("TLINK-116: ?table=7&mode=edit + authenticated + list contains it -> opened in edit mode", async () => {
    window.history.replaceState(null, "", "/?table=7&mode=edit");
    useAuthStore.setState({ status: "authenticated" });
    const table7 = makeTable(7);
    listTablesMock.mockResolvedValue([table7]);

    const { result } = renderHook(() => useDeepLinkTable());

    await waitFor(() => expect(result.current.status).toBe("opened"));
    const opened = result.current as Extract<DeepLinkTableState, { status: "opened" }>;
    expect(opened.table).toEqual(table7);
    expect(opened.mode).toBe("edit");
  });

  it("TLINK-116: ?table=7&mode=banana -> mode resolves to view, not an error", async () => {
    window.history.replaceState(null, "", "/?table=7&mode=banana");
    useAuthStore.setState({ status: "authenticated" });
    const table7 = makeTable(7);
    listTablesMock.mockResolvedValue([table7]);

    const { result } = renderHook(() => useDeepLinkTable());

    await waitFor(() => expect(result.current.status).toBe("opened"));
    const opened = result.current as Extract<DeepLinkTableState, { status: "opened" }>;
    expect(opened.mode).toBe("view");
  });

  it("TLINK-116: ?table=99 absent from the list -> unavailable, param stripped", async () => {
    window.history.replaceState(null, "", "/?table=99");
    useAuthStore.setState({ status: "authenticated" });
    listTablesMock.mockResolvedValue([makeTable(7)]);

    const { result } = renderHook(() => useDeepLinkTable());

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(window.location.search).toBe("");
  });

  it("TLINK-116: listTables rejects while authenticated -> error, param stripped", async () => {
    window.history.replaceState(null, "", "/?table=7");
    useAuthStore.setState({ status: "authenticated" });
    listTablesMock.mockRejectedValue(new Error("500"));

    const { result } = renderHook(() => useDeepLinkTable());

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(window.location.search).toBe("");
  });

  it("TLINK-116: rejection arriving after the session ends stays pending, param survives", async () => {
    window.history.replaceState(null, "", "/?table=7");
    useAuthStore.setState({ status: "authenticated" });
    let rejectFn!: (err: unknown) => void;
    listTablesMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectFn = reject;
      }),
    );

    const { result } = renderHook(() => useDeepLinkTable());
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
    expect(window.location.search).toBe("?table=7");
  });

  it("TLINK-116: ?table=abc (junk) -> none, param stripped, listTables not called", () => {
    window.history.replaceState(null, "", "/?table=abc");
    useAuthStore.setState({ status: "authenticated" });

    const { result } = renderHook(() => useDeepLinkTable());

    expect(result.current.status).toBe("none");
    expect(window.location.search).toBe("");
    expect(listTablesMock).not.toHaveBeenCalled();
  });

  it("TLINK-116: auth status unknown at boot stays pending until authenticated, then resolves", async () => {
    window.history.replaceState(null, "", "/?table=7");
    useAuthStore.setState({ status: "unknown" });
    const table7 = makeTable(7);
    listTablesMock.mockResolvedValue([table7]);

    const { result } = renderHook(() => useDeepLinkTable());

    expect(result.current.status).toBe("pending");
    expect(listTablesMock).not.toHaveBeenCalled();

    act(() => {
      useAuthStore.setState({ status: "authenticated" });
    });

    await waitFor(() => expect(result.current.status).toBe("opened"));
  });

  it("TLINK-116: StrictMode double-invoke still calls listTables exactly once", async () => {
    window.history.replaceState(null, "", "/?table=7");
    useAuthStore.setState({ status: "authenticated" });
    listTablesMock.mockResolvedValue([makeTable(7)]);

    const { result } = renderHook(() => useDeepLinkTable(), {
      wrapper: ({ children }) => React.createElement(React.StrictMode, null, children),
    });

    await waitFor(() => expect(result.current.status).toBe("opened"));
    expect(listTablesMock).toHaveBeenCalledTimes(1);
  });

  it("TLINK-116: the unavailable message names neither a permission nor an id", () => {
    expect(DEEP_LINK_TABLE_UNAVAILABLE_MESSAGE.length).toBeGreaterThan(0);
    expect(DEEP_LINK_TABLE_UNAVAILABLE_MESSAGE).not.toMatch(/access/i);
    expect(DEEP_LINK_TABLE_UNAVAILABLE_MESSAGE).not.toMatch(/\d/);
  });
});

describe("useDeepLinkTable — storedTable parameter (mirrors Phase 115 storedId)", () => {
  it("TLINK-116: stored {id:12, mode:'edit'} on a bare URL + authenticated + list contains 12 -> opened in edit mode", async () => {
    window.history.replaceState(null, "", "/");
    useAuthStore.setState({ status: "authenticated" });
    const table12 = makeTable(12);
    listTablesMock.mockResolvedValue([table12]);

    const { result } = renderHook(() => useDeepLinkTable({ id: 12, mode: "edit" }));

    expect(result.current.status).toBe("pending");
    await waitFor(() => expect(result.current.status).toBe("opened"));
    const opened = result.current as Extract<DeepLinkTableState, { status: "opened" }>;
    expect(opened.table).toEqual(table12);
    expect(opened.mode).toBe("edit");
  });

  it("TLINK-116: stored table with auth status unknown at boot stays pending until authenticated, then resolves", async () => {
    window.history.replaceState(null, "", "/");
    useAuthStore.setState({ status: "unknown" });
    const table12 = makeTable(12);
    listTablesMock.mockResolvedValue([table12]);

    const { result } = renderHook(() => useDeepLinkTable({ id: 12, mode: "view" }));

    expect(result.current.status).toBe("pending");
    expect(listTablesMock).not.toHaveBeenCalled();

    act(() => {
      useAuthStore.setState({ status: "authenticated" });
    });

    await waitFor(() => expect(result.current.status).toBe("opened"));
  });

  it("TLINK-116: URL ?table=7 beats stored {id:12,...} -> resolves 7, not 12", async () => {
    window.history.replaceState(null, "", "/?table=7");
    useAuthStore.setState({ status: "authenticated" });
    const table7 = makeTable(7);
    listTablesMock.mockResolvedValue([table7]);

    const { result } = renderHook(() => useDeepLinkTable({ id: 12, mode: "edit" }));

    await waitFor(() => expect(result.current.status).toBe("opened"));
    const opened = result.current as Extract<DeepLinkTableState, { status: "opened" }>;
    expect(opened.table).toEqual(table7);
    expect(opened.mode).toBe("view");
  });

  it("TLINK-116: stored null/undefined/absent on a bare URL -> none, listTables never called", () => {
    window.history.replaceState(null, "", "/");
    useAuthStore.setState({ status: "authenticated" });

    const { result: resultNull } = renderHook(() => useDeepLinkTable(null));
    expect(resultNull.current.status).toBe("none");

    const { result: resultUndefined } = renderHook(() => useDeepLinkTable(undefined));
    expect(resultUndefined.current.status).toBe("none");

    const { result: resultAbsent } = renderHook(() => useDeepLinkTable());
    expect(resultAbsent.current.status).toBe("none");

    expect(listTablesMock).not.toHaveBeenCalled();
  });

  it('TLINK-116: invalid stored id shapes (0, -3, 1.5, "12") on a bare URL -> none, listTables never called', () => {
    window.history.replaceState(null, "", "/");
    useAuthStore.setState({ status: "authenticated" });

    for (const bad of [0, -3, 1.5, "12" as unknown as number]) {
      const { result } = renderHook(() => useDeepLinkTable({ id: bad, mode: "view" }));
      expect(result.current.status).toBe("none");
    }

    expect(listTablesMock).not.toHaveBeenCalled();
  });

  it("TLINK-116: stored id resolves with exactly ONE listTables call under StrictMode", async () => {
    window.history.replaceState(null, "", "/");
    useAuthStore.setState({ status: "authenticated" });
    listTablesMock.mockResolvedValue([makeTable(12)]);

    const { result } = renderHook(() => useDeepLinkTable({ id: 12, mode: "view" }), {
      wrapper: ({ children }) => React.createElement(React.StrictMode, null, children),
    });

    await waitFor(() => expect(result.current.status).toBe("opened"));
    expect(listTablesMock).toHaveBeenCalledTimes(1);
  });

  it("TLINK-116: URL ?table=abc (junk) is stripped AND the stored 12 still resolves", async () => {
    window.history.replaceState(null, "", "/?table=abc");
    useAuthStore.setState({ status: "authenticated" });
    listTablesMock.mockResolvedValue([makeTable(12)]);

    const { result } = renderHook(() => useDeepLinkTable({ id: 12, mode: "edit" }));

    expect(window.location.search).toBe("");
    await waitFor(() => expect(result.current.status).toBe("opened"));
    const opened = result.current as Extract<DeepLinkTableState, { status: "opened" }>;
    expect(opened.table.id).toBe(12);
    expect(opened.mode).toBe("edit");
  });
});
