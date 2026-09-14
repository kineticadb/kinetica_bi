// Phase 116 Plan 03 (TLINK-V121-01/05/06/07): URL-sync wiring specs for DatasetsPage.
//
// Mirrors DashboardsPage.urlsync.spec.tsx's test STRUCTURE and its
// openDashboardUrl/DASHBOARD_HISTORY_MARKER import trick for seeding a marked entry, but
// deliberately does NOT copy its heavy map-library mocking block — DatasetsPage does not
// import any mapping library, so those stubs are dead weight. Harness is instead based on the
// lighter DatasetsPage.spec.tsx mock shape (partial api/client mock + columnDisplayConfigStore stub).
//
// Every test title is prefixed "TLINK-116:" per the plan's grep anchor.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { seedDesignerStore } from "../test/seedAuthStore";
import { useAuthStore } from "../store/auth";
import { TABLE_HISTORY_MARKER, openTableUrl } from "../lib/tableUrl";

// Mock the api/client module — stub listTables + the CRUD calls DatasetsPage's subcomponents use.
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    listTables: vi.fn(() => Promise.resolve([])),
    updateTable: vi.fn(() => Promise.resolve({})),
    deleteTableEntry: vi.fn(() => Promise.resolve()),
    createTableEntry: vi.fn(() => Promise.resolve({})),
    fetchKineticaSchemas: vi.fn(() => Promise.resolve([])),
    fetchKineticaTables: vi.fn(() => Promise.resolve([])),
    fetchKineticaColumns: vi.fn(() => Promise.resolve({})),
  };
});

// Mock the columnDisplayConfigStore so ColumnFormatEditorModal's loadConfig (if ever mounted)
// doesn't make real network calls — mirrors DatasetsPage.spec.tsx's harness.
vi.mock("../store/columnDisplayConfigStore", () => ({
  useColumnDisplayConfigStore: Object.assign(
    vi.fn(() => ({ configs: {} })),
    {
      getState: vi.fn(() => ({
        configs: {},
        loadConfig: vi.fn(() => Promise.resolve()),
        upsertColumn: vi.fn(),
        removeColumn: vi.fn(),
      })),
    }
  ),
}));

import DatasetsPage from "./DatasetsPage";
import { listTables, updateTable } from "../api/client";

const TABLE_DTO = {
  id: 42,
  name: "orders",
  schema: "public",
  description: "Order records",
  columns: { order_id: "int", amount: "double" },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

const TABLE_43 = {
  ...TABLE_DTO,
  id: 43,
  name: "customers",
};

const openViaClick = async (buttonName: "View" | "Edit" = "View") => {
  (listTables as ReturnType<typeof vi.fn>).mockResolvedValue([TABLE_DTO]);
  const utils = render(<DatasetsPage />);
  await screen.findByText(TABLE_DTO.name);
  const btn = await screen.findByRole("button", { name: buttonName });
  await userEvent.click(btn);
  return utils;
};

describe("DatasetsPage URL sync (Phase 116)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    seedDesignerStore();
    (listTables as ReturnType<typeof vi.fn>).mockReset();
    (updateTable as ReturnType<typeof vi.fn>).mockReset();
    (listTables as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it("TLINK-116: clicking View puts ?table=42 in the address bar", async () => {
    await openViaClick("View");
    expect(window.location.search).toBe("?table=42");
    expect((window.history.state as Record<string, unknown>)[TABLE_HISTORY_MARKER]).toBe(true);
  });

  it("TLINK-116: clicking Edit puts ?table=42&mode=edit in the address bar", async () => {
    await openViaClick("Edit");
    expect(window.location.search).toBe("?table=42&mode=edit");
  });

  it("TLINK-116: each open pushes exactly ONE history entry", async () => {
    const lengthBefore = window.history.length;
    await openViaClick("View");
    expect(window.history.length).toBe(lengthBefore + 1);
  });

  it("TLINK-116: Save from the edit screen rewrites the bar to ?table=42 and does NOT change history.length", async () => {
    await openViaClick("Edit");
    const lengthAfterOpen = window.history.length;
    (updateTable as ReturnType<typeof vi.fn>).mockResolvedValue(TABLE_DTO);
    const saveBtn = await screen.findByRole("button", { name: /^save$/i });
    await userEvent.click(saveBtn);
    await waitFor(() => expect(window.location.search).toBe("?table=42"));
    expect(window.history.length).toBe(lengthAfterOpen);
  });

  it("TLINK-116: after a Save on a SELF-OPENED edit, the in-app Back still POPS (marker preserved)", async () => {
    await openViaClick("Edit");
    (updateTable as ReturnType<typeof vi.fn>).mockResolvedValue(TABLE_DTO);
    const saveBtn = await screen.findByRole("button", { name: /^save$/i });
    await userEvent.click(saveBtn);
    await screen.findByText("Format columns"); // now on TableDetail (view)
    const backSpy = vi.spyOn(window.history, "back");
    const backBtn = await screen.findByRole("button", { name: /^back$/i });
    await userEvent.click(backBtn);
    expect(backSpy).toHaveBeenCalledTimes(1);
    backSpy.mockRestore();
  });

  it("TLINK-116: after a Save on a DEEP-LINK-ARRIVED edit, the in-app Back still WRITES (marker correctly still absent)", async () => {
    window.history.replaceState(null, "", "/?table=42&mode=edit");
    (updateTable as ReturnType<typeof vi.fn>).mockResolvedValue(TABLE_DTO);
    render(<DatasetsPage initialOpenTable={{ table: TABLE_DTO, mode: "edit" }} />);
    const saveBtn = await screen.findByRole("button", { name: /^save$/i });
    await userEvent.click(saveBtn);
    await screen.findByText("Format columns"); // now on TableDetail (view)
    const backBtn = await screen.findByRole("button", { name: /^back$/i });
    await userEvent.click(backBtn);
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(await screen.findByRole("button", { name: /new dataset/i })).toBeInTheDocument();
  });

  it("TLINK-116: browser Back from an open table returns to the tables list", async () => {
    await openViaClick("View");
    await act(async () => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByRole("button", { name: /new dataset/i })).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("TLINK-116: browser Forward into an entry already left clears the stale param instead of re-opening", async () => {
    await openViaClick("View");
    const backBtn = await screen.findByRole("button", { name: /^back$/i });
    await userEvent.click(backBtn);
    await screen.findByRole("button", { name: /new dataset/i });

    await act(async () => {
      window.history.replaceState(null, "", "/?table=42");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await waitFor(() => expect(window.location.search).toBe(""));
    // The list is still on screen — we reconciled the URL, we did NOT open anything.
    expect(screen.getByRole("button", { name: /new dataset/i })).toBeInTheDocument();
  });

  it("TLINK-116: the in-app Back from a deep-link arrival writes the list URL instead of ejecting", async () => {
    window.history.replaceState(null, "", "/?table=42");
    render(<DatasetsPage initialOpenTable={{ table: TABLE_DTO, mode: "view" }} />);
    const backBtn = await screen.findByRole("button", { name: /^back$/i });
    await userEvent.click(backBtn);
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(await screen.findByRole("button", { name: /new dataset/i })).toBeInTheDocument();
  });

  it("TLINK-116: unmounting the datasets page while authenticated with a table open clears the param", async () => {
    const { unmount } = await openViaClick("View");
    expect(window.location.search).toBe("?table=42");
    unmount();
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("TLINK-116: unmounting after the session ended leaves the param alone", async () => {
    const { unmount } = await openViaClick("View");
    expect(window.location.search).toBe("?table=42");
    useAuthStore.setState({ status: "unauthenticated", user: null });
    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(window.location.search).toBe("?table=42");
  });

  it("TLINK-116: StrictMode double-invoke does not wipe the just-opened param", async () => {
    (listTables as ReturnType<typeof vi.fn>).mockResolvedValue([TABLE_DTO]);

    const React = await import("react");
    await act(async () => {
      render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(DatasetsPage, {}),
        ),
      );
    });
    await screen.findByText(TABLE_DTO.name);
    const viewBtn = await screen.findByRole("button", { name: "View" });
    await act(async () => {
      await userEvent.click(viewBtn);
    });
    // Let the deferred clear fire, or not — the trailing macrotask wait is mandatory,
    // without it the timer has not had a chance to fire and the test passes vacuously.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(window.location.search).toBe("?table=42");
  });

  it("TLINK-116: a stale unmount timer does not clear a DIFFERENT table's freshly-pushed param", async () => {
    const { unmount } = await openViaClick("View");
    expect(window.location.search).toBe("?table=42");
    // open table 42, then sidebar-away (unmount) — this SCHEDULES the deferred clear
    unmount();
    // user immediately reopens a DIFFERENT table, synchronously
    openTableUrl(TABLE_43.id, "view");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0)); // now 42's stale timer fires
    });
    expect(window.location.search).toBe("?table=43"); // 43's param survives
  });
});

// Phase 116 Plan 03 (TLINK-V121-02): initialOpenTable wiring.
describe("DatasetsPage initialOpenTable (Phase 116 Plan 03)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    seedDesignerStore();
    (listTables as ReturnType<typeof vi.fn>).mockReset();
    (listTables as ReturnType<typeof vi.fn>).mockResolvedValue([TABLE_DTO]);
  });

  it("TLINK-116: mounts straight into VIEW when initialOpenTable.mode is 'view' — the list chrome is NOT in the document", async () => {
    window.history.replaceState(null, "", "/?table=42");
    const { unmount } = render(<DatasetsPage initialOpenTable={{ table: TABLE_DTO, mode: "view" }} />);
    expect(await screen.findByRole("button", { name: /^back$/i })).toBeInTheDocument();
    // The list's header row (className "ds-header") is structurally absent — not merely a text
    // check, since TableDetail's own "Schema" DETAIL LABEL would otherwise collide with a bare
    // text query for "Schema" (the ds-header COLUMN header the plan names).
    expect(document.querySelector(".ds-header")).toBeNull();
    expect(screen.queryByRole("button", { name: /new dataset/i })).toBeNull();
    // Explicit unmount + macrotask flush so THIS instance's deferred unmount-clear timer fires
    // and settles WITHIN this test, rather than leaking into the next test's identical table id
    // via RTL's automatic afterEach cleanup() (mirrors DashboardsPage.urlsync.spec.tsx's
    // DEEPLINK-114 "mounts straight into the open dashboard" test).
    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("TLINK-116: mounts straight into EDIT when initialOpenTable.mode is 'edit'", async () => {
    window.history.replaceState(null, "", "/?table=42&mode=edit");
    const { unmount } = render(<DatasetsPage initialOpenTable={{ table: TABLE_DTO, mode: "edit" }} />);
    expect(await screen.findByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new dataset/i })).toBeNull();
    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("TLINK-116: a deep-link arrival pushes no history entry of its own", async () => {
    window.history.replaceState(null, "", "/?table=42");
    const lengthBefore = window.history.length;
    const { unmount } = render(<DatasetsPage initialOpenTable={{ table: TABLE_DTO, mode: "view" }} />);
    await screen.findByRole("button", { name: /^back$/i });
    expect(window.location.search).toBe("?table=42");
    expect(window.history.length).toBe(lengthBefore);
    expect((window.history.state as Record<string, unknown> | null ?? {})[TABLE_HISTORY_MARKER]).toBeUndefined();
    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("TLINK-116: without initialOpenTable the page still starts on the list", async () => {
    render(<DatasetsPage />);
    expect(await screen.findByRole("button", { name: /new dataset/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^back$/i })).toBeNull();
  });
});
