/**
 * Phase 34 Plan 02 (DV-V16-08, DV-V16-11): DynamicViewsModal spec — shell + left list + delete flow.
 *
 * Coverage matrix (M1-M12) per 34-02-PLAN.md:
 *   M1  — Mount + initial render (no views) — loading, empty state
 *   M2  — Mount + initial render (with views) — row text, trash btn, right-pane placeholder
 *   M3  — Row selection (active class + right-pane heading)
 *   M4  — ESC handler routes through onClose
 *   M5  — Click-outside routes through onClose; inside-click does NOT
 *   M6  — Close button routes through onClose
 *   M7  — + New dynamic view button toggles right pane to draft state
 *   M8  — Inline delete-confirm happy path (deleteDynamicView + clearView + toast)
 *   M9  — Inline delete-confirm cancel (Keep view)
 *   M10 — Inline delete-confirm error path (toast error, row preserved)
 *   M11 — Status badge per row (real setView action exercises Phase 33 mutation path)
 *   M12 — AbortController cleanup on unmount
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import DynamicViewsModal from "./DynamicViewsModal";
import * as clientModule from "../api/client";
import type { DynamicViewRow, TableDto } from "../api/client";
import { useDynamicViewStore } from "../store/dynamicViewStore";
import { useToastStore } from "../store/toast";
import { useAuthStore } from "../store/auth";  // Plan 34-04 — spied for Save tests (username for buildDynamicViewName)

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    listDynamicViews: vi.fn(),
    deleteDynamicView: vi.fn(),
    previewDynamicView: vi.fn(),
    createDynamicView: vi.fn(),       // NEW Plan 34-04
    updateDynamicView: vi.fn(),       // NEW Plan 34-04
    materializeDynamicView: vi.fn(),  // NEW Plan 34-04
  };
});

// Mock CodeMirror so the SQL editor renders as a <textarea data-testid="cm-editor"> in jsdom.
// The stub also exposes a fake EditorView via globalThis.__lastEditorView so tests can assert
// view.dispatch() calls with the verified CM6 cursor-position API.
vi.mock("@uiw/react-codemirror", () => ({
  __esModule: true,
  default: vi.fn((props: Record<string, unknown>) => {
    const value = (props.value as string | undefined) ?? "";
    const stubView = {
      state: {
        selection: { main: { head: 0 } },
        doc: { length: value.length },
      },
      dispatch: vi.fn((spec: { changes?: { from?: number; insert?: string } }) => {
        if (spec?.changes?.insert !== undefined) {
          const insert = spec.changes.insert;
          const from = spec.changes.from ?? 0;
          const next = value.slice(0, from) + insert + value.slice(from);
          (props.onChange as ((v: string) => void) | undefined)?.(next);
        }
      }),
      focus: vi.fn(),
    };
    (globalThis as unknown as { __lastEditorView?: unknown }).__lastEditorView = stubView;
    setTimeout(() => {
      (props.onCreateEditor as ((v: unknown, s: unknown) => void) | undefined)?.(
        stubView,
        stubView.state,
      );
    }, 0);
    return React.createElement("textarea", {
      "data-testid": "cm-editor",
      value,
      onChange: (e: { target: { value: string } }) =>
        (props.onChange as ((v: string) => void) | undefined)?.(e.target.value),
      placeholder: props.placeholder as string | undefined,
    });
  }),
  // Named export consumed for the editor's dark theme (theme={oneDark}).
  oneDark: [],
}));

vi.mock("@codemirror/lang-sql", () => ({
  sql: vi.fn(() => []),
}));

const mockedClient = clientModule as unknown as {
  listDynamicViews: ReturnType<typeof vi.fn>;
  deleteDynamicView: ReturnType<typeof vi.fn>;
  previewDynamicView: ReturnType<typeof vi.fn>;
  createDynamicView: ReturnType<typeof vi.fn>;       // NEW Plan 34-04
  updateDynamicView: ReturnType<typeof vi.fn>;       // NEW Plan 34-04
  materializeDynamicView: ReturnType<typeof vi.fn>;  // NEW Plan 34-04
};

// Fixture helpers
const makeRow = (id: number, name: string): DynamicViewRow => ({
  id,
  dashboard_id: 5,
  source_table_id: 2,
  name,
  template_sql: "SELECT * FROM {view}",
  max_records: 1000,
  columns_json: null,
  created_at: "2026-05-14T00:00:00Z",
  updated_at: "2026-05-14T00:00:00Z",
});

const sampleTables: TableDto[] = [
  {
    id: 2,
    name: "t",
    schema: "public",
    columns: { col1: "VARCHAR" },
    created_at: "2026-05-14T00:00:00Z",
    updated_at: "2026-05-14T00:00:00Z",
  },
];

describe("DynamicViewsModal", () => {
  let showToastSpy: (message: string, kind?: string) => void;
  let showToastCalls: Array<[string, string | undefined]>;

  beforeEach(() => {
    mockedClient.listDynamicViews.mockReset();
    mockedClient.deleteDynamicView.mockReset();
    mockedClient.previewDynamicView.mockReset();
    mockedClient.createDynamicView.mockReset();        // NEW Plan 34-04
    mockedClient.updateDynamicView.mockReset();        // NEW Plan 34-04
    mockedClient.materializeDynamicView.mockReset();   // NEW Plan 34-04
    // Default: resolved empty list
    mockedClient.listDynamicViews.mockResolvedValue({ dynamic_views: [] });
    // Post-VERIFY default: Save now auto-Previews when formColumnsJson is null. Provide a
    // generic default Preview response so Save-path tests don't deadlock waiting for an
    // un-mocked previewDynamicView. Tests that exercise Preview-error / Preview-validation
    // paths override this with .mockResolvedValueOnce / .mockRejectedValueOnce.
    mockedClient.previewDynamicView.mockResolvedValue({
      rows: [],
      columns: [{ name: "col1", type: "string" }],
    });
    // Reset dynamic view store (auto-applied by zustand mock shim, defensive)
    useDynamicViewStore.setState({ views: {}, dynamicViewVersion: 0 });
    // Spy on toast — record showToast invocations into a typed call log.
    showToastCalls = [];
    showToastSpy = (message: string, kind?: string) => {
      showToastCalls.push([message, kind]);
    };
    // Replace showToast on the current store snapshot. Cast through unknown to satisfy the
    // ToastKind union (the spec doesn't need to honor the union — it just records calls).
    const realShowToast = useToastStore.getState().showToast;
    vi.spyOn(useToastStore.getState(), "showToast").mockImplementation(
      ((message: string, kind?: string) => {
        showToastSpy(message, kind);
      }) as unknown as typeof realShowToast,
    );
  });

  // Test-helper assertion for toast calls (replaces ReturnType<typeof vi.fn> ergonomics).
  const expectToastCalledWith = (message: string, kind?: string): void => {
    const match = showToastCalls.find((c) => c[0] === message && c[1] === kind);
    expect(
      match,
      `expected toast (${message}, ${kind}) — got: ${JSON.stringify(showToastCalls)}`,
    ).toBeTruthy();
  };

  describe("M1: Mount + initial render (no views)", () => {
    it("renders inside .modal-overlay with title 'Dynamic Views'", async () => {
      const { container } = render(
        <DynamicViewsModal dashboardId={5} associatedTables={sampleTables} onClose={() => {}} />,
      );
      expect(container.querySelector(".modal-overlay")).toBeTruthy();
      expect(screen.getByText("Dynamic Views")).toBeInTheDocument();
    });

    it("renders empty state 'No dynamic views yet.' after empty list resolves; right pane shows 'Select a view or click + New to get started.'", async () => {
      render(<DynamicViewsModal dashboardId={5} associatedTables={sampleTables} onClose={() => {}} />);
      await screen.findByText("No dynamic views yet.");
      expect(screen.getByText(/Select a view or click \+ New to get started/i)).toBeInTheDocument();
      // + New button visible
      expect(screen.getByRole("button", { name: /\+ New dynamic view/i })).toBeInTheDocument();
    });
  });

  describe("M2: Mount + initial render (with views)", () => {
    it("renders all rows with view names + trash buttons after list resolves", async () => {
      const row1 = makeRow(1, "alpha");
      const row2 = makeRow(2, "beta");
      mockedClient.listDynamicViews.mockResolvedValueOnce({ dynamic_views: [row1, row2] });
      render(<DynamicViewsModal dashboardId={5} associatedTables={sampleTables} onClose={() => {}} />);
      await screen.findByText("alpha");
      expect(screen.getByText("beta")).toBeInTheDocument();
      // Two trash buttons (aria-label="Delete view")
      const trashes = screen.getAllByRole("button", { name: "Delete view" });
      expect(trashes.length).toBe(2);
    });

    it("right pane initially shows placeholder 'Select a view or click + New to get started.' even when rows exist", async () => {
      const row1 = makeRow(1, "alpha");
      mockedClient.listDynamicViews.mockResolvedValueOnce({ dynamic_views: [row1] });
      render(<DynamicViewsModal dashboardId={5} associatedTables={sampleTables} onClose={() => {}} />);
      await screen.findByText("alpha");
      expect(screen.getByText(/Select a view or click \+ New to get started/i)).toBeInTheDocument();
    });
  });

  describe("M3: Row selection", () => {
    it("clicking a row sets active state and renders the form populated with the row's values (migrated 34-03)", async () => {
      const row1 = makeRow(1, "alpha");
      const row2 = makeRow(2, "beta");
      mockedClient.listDynamicViews.mockResolvedValueOnce({ dynamic_views: [row1, row2] });
      const { container } = render(
        <DynamicViewsModal dashboardId={5} associatedTables={sampleTables} onClose={() => {}} />,
      );
      const alphaText = await screen.findByText("alpha");
      fireEvent.click(alphaText);
      // 34-03 migration: form fields render (Name input + CodeMirror editor) instead of placeholder heading.
      const nameInput = await screen.findByPlaceholderText("Name your dynamic view");
      expect((nameInput as HTMLInputElement).value).toBe("alpha");
      expect(screen.getByTestId("cm-editor")).toBeInTheDocument();
      // Active class
      const activeRows = container.querySelectorAll(".view-row.active");
      expect(activeRows.length).toBe(1);
    });

    it("clicking a different row swaps the active class", async () => {
      const row1 = makeRow(1, "alpha");
      const row2 = makeRow(2, "beta");
      mockedClient.listDynamicViews.mockResolvedValueOnce({ dynamic_views: [row1, row2] });
      const { container } = render(
        <DynamicViewsModal dashboardId={5} associatedTables={sampleTables} onClose={() => {}} />,
      );
      const alphaText = await screen.findByText("alpha");
      const betaText = await screen.findByText("beta");
      fireEvent.click(alphaText);
      fireEvent.click(betaText);
      await waitFor(() => {
        const active = container.querySelector(".view-row.active");
        expect(active).toBeTruthy();
        expect(active?.textContent).toContain("beta");
      });
    });
  });

  describe("M4: ESC handler", () => {
    it("pressing ESC calls onClose exactly once", async () => {
      const onClose = vi.fn();
      render(<DynamicViewsModal dashboardId={5} associatedTables={sampleTables} onClose={onClose} />);
      await screen.findByText("No dynamic views yet.");
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("M5: Click-outside", () => {
    it("clicking .modal-overlay backdrop calls onClose exactly once", async () => {
      const onClose = vi.fn();
      const { container } = render(
        <DynamicViewsModal dashboardId={5} associatedTables={sampleTables} onClose={onClose} />,
      );
      const overlay = container.querySelector(".modal-overlay");
      expect(overlay).toBeTruthy();
      fireEvent.click(overlay!);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("clicking inside the modal content does NOT call onClose", async () => {
      const onClose = vi.fn();
      render(<DynamicViewsModal dashboardId={5} associatedTables={sampleTables} onClose={onClose} />);
      const title = screen.getByText("Dynamic Views");
      fireEvent.click(title);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("M6: Close button", () => {
    it("clicking Close button calls onClose exactly once", async () => {
      const onClose = vi.fn();
      render(<DynamicViewsModal dashboardId={5} associatedTables={sampleTables} onClose={onClose} />);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("M7: + New dynamic view button", () => {
    it("clicking + New dynamic view renders the draft form in right pane (migrated 34-03)", async () => {
      // 34-03 migration: replaced placeholder text assertion with form-field checks.
      render(<DynamicViewsModal dashboardId={5} associatedTables={sampleTables} onClose={() => {}} />);
      await screen.findByText("No dynamic views yet.");
      const newBtn = screen.getByRole("button", { name: /\+ New dynamic view/i });
      fireEvent.click(newBtn);
      expect(screen.getByPlaceholderText("Name your dynamic view")).toBeInTheDocument();
      expect(screen.getByTestId("cm-editor")).toBeInTheDocument();
    });
  });

  describe("M8: Inline delete-confirm — happy path", () => {
    it("trash → [Delete view] confirms swap; confirm fires deleteDynamicView + clearView + toast 'View deleted'; row removed", async () => {
      const row1 = makeRow(1, "alpha");
      const row2 = makeRow(2, "beta");
      mockedClient.listDynamicViews.mockResolvedValueOnce({ dynamic_views: [row1, row2] });
      mockedClient.deleteDynamicView.mockResolvedValueOnce({ deleted: true });
      // Seed a store entry to verify clearView is called
      useDynamicViewStore.getState().setView(row1.id, { viewName: "x", status: "materialized" });
      render(<DynamicViewsModal dashboardId={5} associatedTables={sampleTables} onClose={() => {}} />);
      await screen.findByText("alpha");
      // Click trash on row1
      const trashes = screen.getAllByRole("button", { name: "Delete view" });
      fireEvent.click(trashes[0]);
      // Confirm swap: [Delete view] text-button visible
      const confirmBtns = await screen.findAllByText("Delete view");
      expect(confirmBtns.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Keep view")).toBeInTheDocument();
      // Click [Delete view] (the inline confirm — find by exact text)
      const deleteBtn = screen.getByText("Delete view");
      fireEvent.click(deleteBtn);
      // Plan 34-04 migration: handleDelete now passes deleteAbortRef.signal as the second arg.
      await waitFor(() => {
        expect(mockedClient.deleteDynamicView).toHaveBeenCalledWith(row1.id, expect.anything());
      });
      // Row1 disappears
      await waitFor(() => {
        expect(screen.queryByText("alpha")).not.toBeInTheDocument();
      });
      // Store entry cleared
      expect(useDynamicViewStore.getState().views[row1.id]).toBeUndefined();
      // Toast called
      expectToastCalledWith("View deleted", "info");
    });
  });

  describe("M9: Inline delete-confirm — Keep view (cancel)", () => {
    it("trash → [Keep view] cancels, deleteDynamicView NOT called, trash returns", async () => {
      const row1 = makeRow(1, "alpha");
      mockedClient.listDynamicViews.mockResolvedValueOnce({ dynamic_views: [row1] });
      render(<DynamicViewsModal dashboardId={5} associatedTables={sampleTables} onClose={() => {}} />);
      await screen.findByText("alpha");
      const trash = screen.getByRole("button", { name: "Delete view" });
      fireEvent.click(trash);
      const keepBtn = await screen.findByText("Keep view");
      fireEvent.click(keepBtn);
      expect(mockedClient.deleteDynamicView).not.toHaveBeenCalled();
      // Trash icon returns
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Delete view" })).toBeInTheDocument();
      });
    });
  });

  describe("M10: Inline delete-confirm — error path", () => {
    it("trash → [Delete view] when server rejects shows error toast + row preserved + confirm resets", async () => {
      const row1 = makeRow(1, "alpha");
      mockedClient.listDynamicViews.mockResolvedValueOnce({ dynamic_views: [row1] });
      mockedClient.deleteDynamicView.mockRejectedValueOnce(new Error("Server down"));
      render(<DynamicViewsModal dashboardId={5} associatedTables={sampleTables} onClose={() => {}} />);
      await screen.findByText("alpha");
      fireEvent.click(screen.getByRole("button", { name: "Delete view" }));
      const deleteBtn = await screen.findByText("Delete view");
      fireEvent.click(deleteBtn);
      await waitFor(() => {
        const match = showToastCalls.find(
          (c) => c[0] === "Failed to delete view: Server down" && c[1] === "error",
        );
        expect(match).toBeTruthy();
      });
      // Row still visible
      expect(screen.getByText("alpha")).toBeInTheDocument();
      // Confirm state reset — trash icon back
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Delete view" })).toBeInTheDocument();
      });
    });
  });

  describe("M11: Status badge per row (real setView action)", () => {
    it("badge renders per-row from useDynamicViewStore via real setView action; mutates via real action", async () => {
      const row1 = makeRow(1, "alpha");
      const row2 = makeRow(2, "beta");
      mockedClient.listDynamicViews.mockResolvedValueOnce({ dynamic_views: [row1, row2] });
      // Seed via real action — exercises Phase 33's setView code path.
      useDynamicViewStore.getState().setView(row1.id, { viewName: "x", status: "materialized" });
      render(<DynamicViewsModal dashboardId={5} associatedTables={sampleTables} onClose={() => {}} />);
      await screen.findByText("alpha");
      const badges = screen.getAllByTestId("view-status-badge");
      // Only row1 has a badge (row2 has no store entry)
      expect(badges.length).toBe(1);
      expect(badges[0].getAttribute("data-status")).toBe("materialized");
      // Mutate via real action — verifies subscription path.
      act(() => {
        useDynamicViewStore
          .getState()
          .setView(row1.id, { viewName: "x", status: "over_threshold", reason: "no_filter" });
      });
      const badges2 = screen.getAllByTestId("view-status-badge");
      expect(badges2[0].getAttribute("data-status")).toBe("over_threshold");
      expect(badges2[0].getAttribute("title")).toContain("No filter active");
    });
  });

  describe("M12: AbortController cleanup on unmount", () => {
    it("listDynamicViews is called with a signal; unmount aborts the signal", async () => {
      let capturedSignal: AbortSignal | undefined;
      mockedClient.listDynamicViews.mockImplementationOnce((_dashboardId, signal) => {
        capturedSignal = signal;
        return new Promise(() => {}); // never resolves
      });
      const { unmount } = render(
        <DynamicViewsModal dashboardId={5} associatedTables={sampleTables} onClose={() => {}} />,
      );
      // Signal captured + not yet aborted
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal!.aborted).toBe(false);
      unmount();
      expect(capturedSignal!.aborted).toBe(true);
    });
  });

  // ===========================================================================
  // Plan 34-03: form + Preview coverage (F1-F8, P1-P7)
  // ===========================================================================

  describe("DynamicViewsModal (form + Preview — Plan 34-03)", () => {
    const tableA: TableDto = {
      id: 2,
      name: "trips",
      schema: "public",
      columns: { col1: "VARCHAR" },
      created_at: "2026-05-14T00:00:00Z",
      updated_at: "2026-05-14T00:00:00Z",
    };
    const tableB: TableDto = {
      id: 3,
      name: "vendors",
      schema: "public",
      columns: { name: "VARCHAR" },
      created_at: "2026-05-14T00:00:00Z",
      updated_at: "2026-05-14T00:00:00Z",
    };
    const multiTables = [tableA, tableB];

    describe("F1: Form renders for + New (draft mode)", () => {
      it("renders name input, source-table picker (first table pre-selected), CodeMirror editor, Insert {view} button, hint, max_records=10000, Preview button, NO Save button", async () => {
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        // Name input
        expect(screen.getByPlaceholderText("Name your dynamic view")).toBeInTheDocument();
        // Source-table picker — first table pre-selected
        const tableSelect = screen.getByLabelText("Source table") as HTMLSelectElement;
        expect(tableSelect.value).toBe("2");
        // CodeMirror editor
        expect(screen.getByTestId("cm-editor")).toBeInTheDocument();
        // Insert {view} button
        expect(screen.getByRole("button", { name: /Insert \{view\}/ })).toBeInTheDocument();
        // Hint text
        expect(
          screen.getByText(/Use \{view\} where you'd reference the source filter view\./),
        ).toBeInTheDocument();
        // max_records input default 10000
        const maxRecordsInput = screen.getByLabelText("Max records") as HTMLInputElement;
        expect(maxRecordsInput.value).toBe("10000");
        // Preview button visible
        expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
        // Plan 34-04 lands the Save button — assertion updated from "NO Save button" to "Save visible".
        expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
      });
    });

    describe("F2: Form renders for existing row select", () => {
      it("populates form fields with row values when an existing row is clicked", async () => {
        const row = makeRow(7, "demo");
        row.template_sql = "SELECT 1";
        row.max_records = 5000;
        row.source_table_id = 3;
        mockedClient.listDynamicViews.mockResolvedValueOnce({ dynamic_views: [row] });
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("demo");
        fireEvent.click(screen.getByText("demo"));
        // Name populated
        const nameInput = await screen.findByPlaceholderText("Name your dynamic view");
        expect((nameInput as HTMLInputElement).value).toBe("demo");
        // SQL populated
        expect((screen.getByTestId("cm-editor") as HTMLTextAreaElement).value).toBe("SELECT 1");
        // max_records populated
        expect((screen.getByLabelText("Max records") as HTMLInputElement).value).toBe("5000");
        // Source table populated
        expect((screen.getByLabelText("Source table") as HTMLSelectElement).value).toBe("3");
      });
    });

    describe("F3: Form-field edits keep form rendered (isDirty tracked internally)", () => {
      it("typing in name input keeps the form visible and does not error", async () => {
        const row = makeRow(1, "alpha");
        mockedClient.listDynamicViews.mockResolvedValueOnce({ dynamic_views: [row] });
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("alpha");
        fireEvent.click(screen.getByText("alpha"));
        const nameInput = await screen.findByPlaceholderText("Name your dynamic view");
        fireEvent.change(nameInput, { target: { value: "alpha-edited" } });
        expect((nameInput as HTMLInputElement).value).toBe("alpha-edited");
        expect(screen.getByTestId("cm-editor")).toBeInTheDocument();
      });
    });

    describe("F4: Form lifecycle — + New resets Preview state", () => {
      it("running Preview then clicking + New resets the preview output panel to idle", async () => {
        mockedClient.previewDynamicView.mockResolvedValueOnce({
          rows: [["a"]],
          columns: [{ name: "vendor", type: "TEXT" }],
        });
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        fireEvent.change(await screen.findByTestId("cm-editor"), {
          target: { value: "SELECT 1 FROM {view}" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Preview" }));
        await waitFor(() =>
          expect(screen.getByText(/1 rows previewed/)).toBeInTheDocument(),
        );
        // Click + New again — preview output resets.
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        await waitFor(() =>
          expect(screen.getByText("Click Preview to see sample data.")).toBeInTheDocument(),
        );
      });
    });

    describe("F5: Insert {view} button inserts at cursor position via CM6 dispatch", () => {
      it("clicking Insert {view} calls view.dispatch with cursor-position changes spec and focuses editor", async () => {
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        // Wait for editor onCreateEditor to fire (microtask in our mock).
        await waitFor(() => {
          const v = (globalThis as unknown as { __lastEditorView?: { dispatch: unknown } })
            .__lastEditorView;
          expect(v).toBeDefined();
        });
        const stubView = (globalThis as unknown as {
          __lastEditorView: {
            state: { selection: { main: { head: number } } };
            dispatch: ReturnType<typeof vi.fn>;
            focus: ReturnType<typeof vi.fn>;
          };
        }).__lastEditorView;
        // Set cursor position to 3
        stubView.state.selection.main.head = 3;
        fireEvent.click(screen.getByRole("button", { name: /Insert \{view\}/ }));
        expect(stubView.dispatch).toHaveBeenCalledWith({
          changes: { from: 3, insert: "{view}" },
        });
        expect(stubView.focus).toHaveBeenCalled();
      });
    });

    describe("F6: max_records clamp-on-blur", () => {
      it("snaps '0' to '1' on blur and surfaces inline error", async () => {
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        const maxInput = (await screen.findByLabelText("Max records")) as HTMLInputElement;
        fireEvent.change(maxInput, { target: { value: "0" } });
        fireEvent.blur(maxInput);
        expect(maxInput.value).toBe("1");
        expect(screen.getByText("Must be at least 1")).toBeInTheDocument();
      });

      it("snaps '-5' to '1' on blur", async () => {
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        const maxInput = (await screen.findByLabelText("Max records")) as HTMLInputElement;
        fireEvent.change(maxInput, { target: { value: "-5" } });
        fireEvent.blur(maxInput);
        expect(maxInput.value).toBe("1");
      });

      it("snaps '0.5' to '1' on blur (rounded then clamped)", async () => {
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        const maxInput = (await screen.findByLabelText("Max records")) as HTMLInputElement;
        fireEvent.change(maxInput, { target: { value: "0.5" } });
        fireEvent.blur(maxInput);
        expect(maxInput.value).toBe("1");
      });

      it("keeps '10000' as '10000' on blur with no error", async () => {
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        const maxInput = (await screen.findByLabelText("Max records")) as HTMLInputElement;
        fireEvent.change(maxInput, { target: { value: "10000" } });
        fireEvent.blur(maxInput);
        expect(maxInput.value).toBe("10000");
        expect(screen.queryByText("Must be at least 1")).not.toBeInTheDocument();
      });

      it("snaps empty string to '1' on blur", async () => {
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        const maxInput = (await screen.findByLabelText("Max records")) as HTMLInputElement;
        fireEvent.change(maxInput, { target: { value: "" } });
        fireEvent.blur(maxInput);
        expect(maxInput.value).toBe("1");
      });

      it("checking 'Unlimited max records' disables the Max records input", async () => {
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        const maxInput = (await screen.findByLabelText("Max records")) as HTMLInputElement;
        const unlimited = screen.getByLabelText("Unlimited max records") as HTMLInputElement;
        expect(maxInput.disabled).toBe(false);
        fireEvent.click(unlimited);
        expect(unlimited.checked).toBe(true);
        expect(maxInput.disabled).toBe(true);
      });
    });

    describe("F7: name input is mutable on + New", () => {
      it("name input is editable in draft mode", async () => {
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        const nameInput = (await screen.findByPlaceholderText(
          "Name your dynamic view",
        )) as HTMLInputElement;
        fireEvent.change(nameInput, { target: { value: "my-view" } });
        expect(nameInput.value).toBe("my-view");
      });
    });

    describe("F8: associatedTables empty → form banner", () => {
      it("renders no-tables banner instead of form when associatedTables is empty", async () => {
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={[]} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        expect(
          screen.getByText(
            "This dashboard has no associated tables. Click Tables to add one first.",
          ),
        ).toBeInTheDocument();
        // No form fields rendered
        expect(screen.queryByPlaceholderText("Name your dynamic view")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
      });
    });

    // ----- Preview tests P1-P7 -----

    describe("P1: Preview not-run — placeholder text", () => {
      it("shows 'Click Preview to see sample data.' initially when + New is opened", async () => {
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        expect(screen.getByText("Click Preview to see sample data.")).toBeInTheDocument();
      });
    });

    describe("P2: Preview loading state", () => {
      it("shows 'Running preview…' while previewDynamicView is pending", async () => {
        mockedClient.previewDynamicView.mockImplementationOnce(() => new Promise(() => {}));
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        fireEvent.change(await screen.findByTestId("cm-editor"), {
          target: { value: "SELECT 1 FROM {view}" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Preview" }));
        await waitFor(() =>
          expect(screen.getByText("Running preview…")).toBeInTheDocument(),
        );
      });
    });

    describe("P3: Preview success — chips + table + footer + persistent flag", () => {
      it("renders alphabetical column chips + table + row count footer", async () => {
        mockedClient.previewDynamicView.mockResolvedValueOnce({
          rows: [
            ["a", 1],
            ["b", 2],
          ],
          columns: [
            { name: "vendor", type: "TEXT" },
            { name: "fare", type: "DOUBLE" },
          ],
        });
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        fireEvent.change(await screen.findByTestId("cm-editor"), {
          target: { value: "SELECT 1 FROM {view}" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Preview" }));
        // Chips: alphabetical → fare, vendor
        await waitFor(() => {
          expect(screen.getByText(/fare\s+DOUBLE/)).toBeInTheDocument();
          expect(screen.getByText(/vendor\s+TEXT/)).toBeInTheDocument();
        });
        // Footer text
        expect(screen.getByText(/2 rows previewed \(sample_limit=100\)/)).toBeInTheDocument();
        // Body cells
        expect(screen.getByText("a")).toBeInTheDocument();
        expect(screen.getByText("b")).toBeInTheDocument();
      });

      it("re-clicking Preview keeps preview state (previewRanSinceLastSave remains observable as success)", async () => {
        mockedClient.previewDynamicView.mockResolvedValue({
          rows: [["a"]],
          columns: [{ name: "vendor", type: "TEXT" }],
        });
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        fireEvent.change(await screen.findByTestId("cm-editor"), {
          target: { value: "SELECT 1 FROM {view}" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Preview" }));
        await waitFor(() => expect(screen.getByText(/1 rows previewed/)).toBeInTheDocument());
        fireEvent.click(screen.getByRole("button", { name: "Preview" }));
        await waitFor(() => expect(screen.getByText(/1 rows previewed/)).toBeInTheDocument());
      });
    });

    describe("P4: Preview 0-rows", () => {
      it("shows chips + 'Query returned 0 rows' message when rows array is empty", async () => {
        mockedClient.previewDynamicView.mockResolvedValueOnce({
          rows: [],
          columns: [{ name: "x", type: "INT" }],
        });
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        fireEvent.change(await screen.findByTestId("cm-editor"), {
          target: { value: "SELECT 1 FROM {view}" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Preview" }));
        await waitFor(() => {
          expect(screen.getByText(/x\s+INT/)).toBeInTheDocument();
          expect(
            screen.getByText("Query returned 0 rows. Check filters and template."),
          ).toBeInTheDocument();
        });
      });
    });

    describe("P5: Preview server error — verbatim message persists across field edits (source: 'server')", () => {
      it("renders server error verbatim with data-error-source='server' and persists across SQL edits", async () => {
        mockedClient.previewDynamicView.mockRejectedValueOnce(
          new Error("Dynamic view template must contain a {view} token."),
        );
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        fireEvent.change(await screen.findByTestId("cm-editor"), {
          target: { value: "SELECT 1" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Preview" }));
        const errBox = await screen.findByText(
          "Dynamic view template must contain a {view} token.",
        );
        expect(errBox.getAttribute("data-error-source")).toBe("server");
        // Edit SQL → error PERSISTS
        fireEvent.change(screen.getByTestId("cm-editor"), {
          target: { value: "SELECT 2 FROM {view}" },
        });
        expect(
          screen.getByText("Dynamic view template must contain a {view} token."),
        ).toBeInTheDocument();
      });
    });

    describe("P6: Preview AbortController cancellation", () => {
      it("clicking Preview twice aborts the first signal; fresh signal sent on second call", async () => {
        const signals: AbortSignal[] = [];
        mockedClient.previewDynamicView.mockImplementation((_body, signal) => {
          if (signal) signals.push(signal);
          return new Promise(() => {});
        });
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        fireEvent.change(await screen.findByTestId("cm-editor"), {
          target: { value: "SELECT 1 FROM {view}" },
        });
        // Use data-testid + aria-label for click — the visible text flips to "Running…" while loading.
        fireEvent.click(screen.getByTestId("preview-button"));
        await waitFor(() => expect(signals.length).toBeGreaterThanOrEqual(1));
        fireEvent.click(screen.getByTestId("preview-button"));
        await waitFor(() => expect(signals.length).toBeGreaterThanOrEqual(2));
        expect(signals[0].aborted).toBe(true);
        expect(signals[1].aborted).toBe(false);
      });

      it("unmounting modal mid-Preview aborts the signal silently (no toast)", async () => {
        let capturedSignal: AbortSignal | undefined;
        mockedClient.previewDynamicView.mockImplementationOnce((_body, signal) => {
          capturedSignal = signal;
          return new Promise(() => {});
        });
        const { unmount } = render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        fireEvent.change(await screen.findByTestId("cm-editor"), {
          target: { value: "SELECT 1 FROM {view}" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Preview" }));
        await waitFor(() => expect(capturedSignal).toBeDefined());
        const callsBefore = showToastCalls.length;
        unmount();
        expect(capturedSignal!.aborted).toBe(true);
        // No toast added by unmount-induced abort
        expect(showToastCalls.length).toBe(callsBefore);
      });
    });

    describe("P7: Preview validation block — source 'validation' resets on field edit", () => {
      it("validation error 'Select a source table and write SQL first.' resets to idle when SQL becomes non-empty", async () => {
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        // SQL is empty — click Preview → validation error
        fireEvent.click(screen.getByRole("button", { name: "Preview" }));
        const errBox = await screen.findByText("Select a source table and write SQL first.");
        expect(errBox.getAttribute("data-error-source")).toBe("validation");
        expect(mockedClient.previewDynamicView).not.toHaveBeenCalled();
        // Type SQL → validation error resets
        fireEvent.change(screen.getByTestId("cm-editor"), {
          target: { value: "SELECT 1 FROM {view}" },
        });
        expect(
          screen.queryByText("Select a source table and write SQL first."),
        ).not.toBeInTheDocument();
        expect(screen.getByText("Click Preview to see sample data.")).toBeInTheDocument();
      });
    });
  });

  // ===========================================================================
  // Plan 34-04: Save handler + dirty-state confirm coverage (S1-S11, D1-D3)
  //
  // Critical: BLOCKER #1 columns_json carry rule — Save body MUST omit columns_json
  // when previewRanSinceLastSave is false (stale-row-load case + post-Save case).
  // S9 + S10 are the regression guards.
  // ===========================================================================

  describe("DynamicViewsModal (Save + dirty-state — Plan 34-04)", () => {
    const tableA: TableDto = {
      id: 2,
      name: "trips",
      schema: "public",
      columns: { col1: "VARCHAR" },
      created_at: "2026-05-14T00:00:00Z",
      updated_at: "2026-05-14T00:00:00Z",
    };
    const tableB: TableDto = {
      id: 3,
      name: "vendors",
      schema: "public",
      columns: { name: "VARCHAR" },
      created_at: "2026-05-14T00:00:00Z",
      updated_at: "2026-05-14T00:00:00Z",
    };
    const multiTables = [tableA, tableB];

    // Spy on useAuthStore.getState() for username. Returns "alice" by default.
    // Returns a cleanup fn to restore in afterEach if needed.
    const setupAuth = (username: string | undefined = "alice") => {
      vi.spyOn(useAuthStore, "getState").mockReturnValue({
        status: "authenticated",
        user: username !== undefined ? { username } : null,
        error: null,
        reason: null,
        authMode: null,
        bootstrap: vi.fn(),
        login: vi.fn(),
        logout: vi.fn(),
        markUnauthenticated: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    };

    // Helper: open + New, fill name + SQL fields.
    const fillNewForm = async (name = "demo", sql = "SELECT 1 FROM {view}") => {
      fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
      const nameInput = await screen.findByPlaceholderText("Name your dynamic view");
      fireEvent.change(nameInput, { target: { value: name } });
      fireEvent.change(screen.getByTestId("cm-editor"), { target: { value: sql } });
    };

    // ----- S1: Validation -----
    describe("S1: Save — local validation blocks network call", () => {
      it("empty name → inline 'Name is required' below name input; createDynamicView NOT called", async () => {
        setupAuth();
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        // Type SQL but leave name empty.
        fireEvent.change(await screen.findByTestId("cm-editor"), {
          target: { value: "SELECT 1 FROM {view}" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        // Inline name-required error appears.
        await waitFor(() =>
          expect(screen.getByText("Name is required")).toBeInTheDocument(),
        );
        expect(mockedClient.createDynamicView).not.toHaveBeenCalled();
      });
    });

    // ----- S2: Happy path CREATE -----
    describe("S2: Save — CRUD success → markPending → materialize → setView + info toast", () => {
      it("calls createDynamicView, markPending, materializeDynamicView, setView (materialized), shows info toast 'materialized'", async () => {
        setupAuth("alice");
        mockedClient.createDynamicView.mockResolvedValue({
          dynamic_view: makeRow(42, "demo"),
        });
        mockedClient.materializeDynamicView.mockResolvedValue({
          status: "materialized",
          view_name: "_kbi_dv_ualice_d5_42",
          row_count: 100,
          expires_at: 1234567890,
        });
        const markPendingSpy = vi.spyOn(useDynamicViewStore.getState(), "markPending");
        const setViewSpy = vi.spyOn(useDynamicViewStore.getState(), "setView");
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        await fillNewForm("demo", "SELECT 1 FROM {view}");
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => expect(mockedClient.createDynamicView).toHaveBeenCalled());
        const createCall = mockedClient.createDynamicView.mock.calls[0];
        expect(createCall[0]).toBe(5); // dashboardId
        const createBody = createCall[1];
        // Post-VERIFY auto-Preview-on-Save: createBody now ALWAYS includes columns_json
        // (sourced from the auto-Preview response when operator didn't run Preview manually).
        // The default Preview mock in beforeEach returns [{name:"col1", type:"string"}].
        expect(createBody).toEqual({
          source_table_id: 2,
          name: "demo",
          template_sql: "SELECT 1 FROM {view}",
          max_records: 10000,
          columns_json: [{ name: "col1", type: "string" }],
        });

        await waitFor(() =>
          expect(markPendingSpy).toHaveBeenCalledWith(42, "_kbi_dv_ualice_d5_42"),
        );
        await waitFor(() =>
          expect(mockedClient.materializeDynamicView).toHaveBeenCalledWith(
            42,
            expect.anything(),
          ),
        );
        await waitFor(() =>
          expect(setViewSpy).toHaveBeenCalledWith(42, {
            viewName: "_kbi_dv_ualice_d5_42",
            status: "materialized",
            expiresAt: 1234567890,
          }),
        );
        await waitFor(() => {
          expect(
            showToastCalls.some(
              ([msg, kind]) => String(msg).includes("materialized") && kind === "info",
            ),
          ).toBe(true);
        });
      });

      it("with 'Unlimited' checked, createDynamicView is called with max_records: 0", async () => {
        setupAuth("alice");
        mockedClient.createDynamicView.mockResolvedValue({
          dynamic_view: makeRow(43, "demo"),
        });
        mockedClient.materializeDynamicView.mockResolvedValue({
          status: "materialized",
          view_name: "_kbi_dv_ualice_d5_43",
          row_count: 100,
          expires_at: 1234567890,
        });
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        await fillNewForm("demo", "SELECT 1 FROM {view}");
        fireEvent.click(screen.getByLabelText("Unlimited max records"));
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => expect(mockedClient.createDynamicView).toHaveBeenCalled());
        expect(mockedClient.createDynamicView.mock.calls[0][1]).toEqual(
          expect.objectContaining({ max_records: 0 }),
        );
      });
    });

    // ----- S3: over_threshold no_filter -----
    describe("S3: Save — materialize returns over_threshold/no_filter → setView + info toast (NOT warning)", () => {
      it("sets store with reason: 'no_filter' and shows info toast with 'no filter active'", async () => {
        setupAuth("alice");
        mockedClient.createDynamicView.mockResolvedValue({
          dynamic_view: makeRow(42, "demo"),
        });
        mockedClient.materializeDynamicView.mockResolvedValue({
          status: "over_threshold",
          reason: "no_filter",
        });
        const setViewSpy = vi.spyOn(useDynamicViewStore.getState(), "setView");
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        await fillNewForm("demo", "SELECT 1 FROM {view}");
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(mockedClient.materializeDynamicView).toHaveBeenCalled());
        await waitFor(() =>
          expect(setViewSpy).toHaveBeenCalledWith(42, {
            viewName: "_kbi_dv_ualice_d5_42",
            status: "over_threshold",
            reason: "no_filter",
          }),
        );
        await waitFor(() => {
          expect(
            showToastCalls.some(
              ([msg, kind]) =>
                String(msg).includes("no filter active") && kind === "info",
            ),
          ).toBe(true);
        });
        // Negative: no warning kind used.
        expect(showToastCalls.some(([, kind]) => kind === "warning")).toBe(false);
      });
    });

    // ----- S4: over_threshold exceeds_max_records -----
    describe("S4: Save — over_threshold/exceeds_max_records → setView + info toast", () => {
      it("sets store with reason: 'exceeds_max_records' and shows info toast with row count", async () => {
        setupAuth("alice");
        mockedClient.createDynamicView.mockResolvedValue({
          dynamic_view: makeRow(42, "demo"),
        });
        mockedClient.materializeDynamicView.mockResolvedValue({
          status: "over_threshold",
          reason: "exceeds_max_records",
          row_count: 15000,
        });
        const setViewSpy = vi.spyOn(useDynamicViewStore.getState(), "setView");
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        await fillNewForm("demo", "SELECT 1 FROM {view}");
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(mockedClient.materializeDynamicView).toHaveBeenCalled());
        await waitFor(() =>
          expect(setViewSpy).toHaveBeenCalledWith(42, {
            viewName: "_kbi_dv_ualice_d5_42",
            status: "over_threshold",
            reason: "exceeds_max_records",
          }),
        );
        await waitFor(() => {
          expect(
            showToastCalls.some(
              ([msg, kind]) =>
                String(msg).includes("15000") &&
                String(msg).includes("exceeds max_records") &&
                kind === "info",
            ),
          ).toBe(true);
        });
        expect(showToastCalls.some(([, kind]) => kind === "warning")).toBe(false);
      });
    });

    // ----- S5: CRUD 400 surfaces verbatim -----
    describe("S5: Save — CRUD 400 surfaces server message verbatim below SQL editor", () => {
      it("renders server message verbatim; materialize not called", async () => {
        setupAuth("alice");
        mockedClient.createDynamicView.mockRejectedValueOnce(
          new Error("Dynamic view template must contain a {view} token."),
        );
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        await fillNewForm("demo", "SELECT 1");
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() =>
          expect(
            screen.getByText("Dynamic view template must contain a {view} token."),
          ).toBeInTheDocument(),
        );
        expect(mockedClient.materializeDynamicView).not.toHaveBeenCalled();
      });
    });

    // ----- S6: Materialize error path -----
    describe("S6: Save — materialize error → setError + error toast", () => {
      it("setError fires on materialize rejection; CRUD persistence NOT rolled back", async () => {
        setupAuth("alice");
        mockedClient.createDynamicView.mockResolvedValue({
          dynamic_view: makeRow(42, "demo"),
        });
        mockedClient.materializeDynamicView.mockRejectedValueOnce(
          new Error("Kinetica error: SqlEngine error"),
        );
        const setErrorSpy = vi.spyOn(useDynamicViewStore.getState(), "setError");
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        await fillNewForm("demo", "SELECT 1 FROM {view}");
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() =>
          expect(setErrorSpy).toHaveBeenCalledWith(42, "Kinetica error: SqlEngine error"),
        );
        await waitFor(() => {
          expect(
            showToastCalls.some(
              ([msg, kind]) =>
                String(msg).includes("Kinetica error") && kind === "error",
            ),
          ).toBe(true);
        });
      });
    });

    // ----- S7: UPDATE no template change → omits columns_json -----
    describe("S7: Save — UPDATE existing row (no template change) → omits columns_json", () => {
      it("body has name/source_table_id/template_sql/max_records — but no columns_json", async () => {
        setupAuth("alice");
        const existing: DynamicViewRow = {
          ...makeRow(5, "existing"),
          template_sql: "SELECT 1",
          columns_json: JSON.stringify([{ name: "col", type: "INT" }]),
        };
        mockedClient.listDynamicViews.mockResolvedValueOnce({ dynamic_views: [existing] });
        mockedClient.updateDynamicView.mockResolvedValue({
          dynamic_view: { ...existing, name: "newname" },
        });
        mockedClient.materializeDynamicView.mockResolvedValue({
          status: "materialized",
          view_name: "_kbi_dv_ualice_d5_5",
          row_count: 1,
          expires_at: 0,
        });
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("existing");
        fireEvent.click(screen.getByText("existing"));
        // Change NAME only (template_sql unchanged).
        const nameInput = await screen.findByPlaceholderText("Name your dynamic view");
        fireEvent.change(nameInput, { target: { value: "newname" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(mockedClient.updateDynamicView).toHaveBeenCalled());
        const body = mockedClient.updateDynamicView.mock.calls[0][1];
        expect(body.name).toBe("newname");
        expect(body.template_sql).toBe("SELECT 1");
        // Template unchanged → omit columns_json (server preserves).
        expect(body).not.toHaveProperty("columns_json");
      });
    });

    // ----- S8: UPDATE template change + Preview ran → sends columns_json -----
    describe("S8: Save — UPDATE template change AND Preview ran → SENDS columns_json from Preview", () => {
      it("body INCLUDES columns_json from previewDynamicView response", async () => {
        setupAuth("alice");
        const existing: DynamicViewRow = {
          ...makeRow(5, "existing"),
          template_sql: "SELECT 1",
          columns_json: JSON.stringify([{ name: "stale", type: "INT" }]),
        };
        mockedClient.listDynamicViews.mockResolvedValueOnce({ dynamic_views: [existing] });
        const newColumns = [{ name: "fresh", type: "DOUBLE" }];
        mockedClient.previewDynamicView.mockResolvedValueOnce({
          rows: [[1]],
          columns: newColumns,
        });
        mockedClient.updateDynamicView.mockResolvedValue({
          dynamic_view: {
            ...existing,
            template_sql: "SELECT 2 FROM {view}",
            columns_json: JSON.stringify(newColumns),
          },
        });
        mockedClient.materializeDynamicView.mockResolvedValue({
          status: "materialized",
          view_name: "_kbi_dv_ualice_d5_5",
          row_count: 1,
          expires_at: 0,
        });
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("existing");
        fireEvent.click(screen.getByText("existing"));
        // Wait for form to load.
        await screen.findByPlaceholderText("Name your dynamic view");
        // Change template_sql.
        fireEvent.change(screen.getByTestId("cm-editor"), {
          target: { value: "SELECT 2 FROM {view}" },
        });
        // Click Preview (resolves with newColumns).
        fireEvent.click(screen.getByRole("button", { name: "Preview" }));
        await waitFor(() => expect(mockedClient.previewDynamicView).toHaveBeenCalled());
        // Now Save.
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(mockedClient.updateDynamicView).toHaveBeenCalled());
        const body = mockedClient.updateDynamicView.mock.calls[0][1];
        expect(body.template_sql).toBe("SELECT 2 FROM {view}");
        // Post-VERIFY type fix: body.columns_json is now the PARSED array shape (not stringified).
        // The server PUT handler expects parsed arrays and the prior `string | null` type
        // caused silent double-encoding. UpdateDynamicViewArgs is now `{name,type}[] | null`.
        expect(body).toHaveProperty("columns_json");
        expect(body.columns_json).toEqual(newColumns);
      });
    });

    // ----- S9: post-VERIFY auto-Preview-on-Save subsumes the old BLOCKER #1 contract -----
    // The original BLOCKER #1 lock prevented stale columns_json from leaking on edit-without-
    // Preview. The post-VERIFY fix supersedes it: Save now auto-Previews when formColumnsJson
    // is null OR when the template changed, so columns_json is ALWAYS sent with FRESH data.
    // (S9 was repurposed; the BLOCKER #1 protection now lives in the auto-Preview guarantee.)
    describe("S9: Save — UPDATE template change WITHOUT manual Preview → auto-Previews + sends FRESH columns_json", () => {
      it("post-VERIFY: edit template + Save without manual Preview auto-Previews and body has FRESH columns_json (not stale row-load)", async () => {
        setupAuth("alice");
        const existing: DynamicViewRow = {
          ...makeRow(5, "existing"),
          template_sql: "SELECT 1",
          columns_json: JSON.stringify([{ name: "stale", type: "INT" }]),
        };
        mockedClient.listDynamicViews.mockResolvedValueOnce({ dynamic_views: [existing] });
        // Auto-Preview returns FRESH columns matching the edited template.
        const freshColumns = [{ name: "fresh_col", type: "DOUBLE" }];
        mockedClient.previewDynamicView.mockResolvedValueOnce({
          rows: [],
          columns: freshColumns,
        });
        mockedClient.updateDynamicView.mockResolvedValue({
          dynamic_view: {
            ...existing,
            template_sql: "SELECT 2 FROM {view}",
            columns_json: freshColumns,
          },
        });
        mockedClient.materializeDynamicView.mockResolvedValue({
          status: "materialized",
          view_name: "_kbi_dv_ualice_d5_5",
          row_count: 1,
          expires_at: 0,
        });
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("existing");
        // Click the row — form populates with the stored stale columns_json.
        fireEvent.click(screen.getByText("existing"));
        await screen.findByPlaceholderText("Name your dynamic view");
        // Change template_sql WITHOUT clicking Preview.
        fireEvent.change(screen.getByTestId("cm-editor"), {
          target: { value: "SELECT 2 FROM {view}" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        // Post-VERIFY: Save now auto-Previews first, then updates with fresh columns.
        await waitFor(() => expect(mockedClient.previewDynamicView).toHaveBeenCalled());
        await waitFor(() => expect(mockedClient.updateDynamicView).toHaveBeenCalled());
        const body = mockedClient.updateDynamicView.mock.calls[0][1];
        expect(body.template_sql).toBe("SELECT 2 FROM {view}");
        // Post-VERIFY assertion — body MUST contain FRESH columns_json from auto-Preview,
        // NOT the stale stored columns_json that was on the row at load time.
        expect(body).toHaveProperty("columns_json");
        expect(body.columns_json).toEqual(freshColumns);
        expect(body.columns_json).not.toEqual([{ name: "stale", type: "INT" }]);
      });
    });

    // ----- S10: post-VERIFY — Save success resets formColumnsJson so next Save re-runs auto-Preview -----
    describe("S10: Save — Save success resets formColumnsJson (next Save without manual Preview triggers auto-Preview again)", () => {
      it("Save → Save (without re-Preview) → second Save re-runs auto-Preview", async () => {
        setupAuth("alice");
        mockedClient.createDynamicView.mockResolvedValue({
          dynamic_view: makeRow(42, "demo"),
        });
        mockedClient.previewDynamicView.mockResolvedValue({
          rows: [["a"]],
          columns: [{ name: "c", type: "TEXT" }],
        });
        mockedClient.materializeDynamicView.mockResolvedValue({
          status: "materialized",
          view_name: "_kbi_dv_ualice_d5_42",
          row_count: 1,
          expires_at: 0,
        });
        mockedClient.updateDynamicView.mockResolvedValue({
          dynamic_view: {
            ...makeRow(42, "demo"),
            template_sql: "SELECT 3 FROM {view}",
            columns_json: null,
          },
        });
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        // Step 1: + New, fill, Preview, Save.
        await fillNewForm("demo", "SELECT 1 FROM {view}");
        fireEvent.click(screen.getByRole("button", { name: "Preview" }));
        await waitFor(() => expect(mockedClient.previewDynamicView).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(mockedClient.createDynamicView).toHaveBeenCalled());
        // Step 2: form now shows saved row (id=42). Change template_sql WITHOUT Preview.
        await waitFor(() => {
          const nameInput = screen.getByPlaceholderText(
            "Name your dynamic view",
          ) as HTMLInputElement;
          expect(nameInput.value).toBe("demo");
        });
        fireEvent.change(screen.getByTestId("cm-editor"), {
          target: { value: "SELECT 3 FROM {view}" },
        });
        // Save again — auto-Preview runs again (formColumnsJson was reset on first Save success).
        const previewCallsBeforeSecondSave = mockedClient.previewDynamicView.mock.calls.length;
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() =>
          expect(mockedClient.previewDynamicView.mock.calls.length).toBeGreaterThan(previewCallsBeforeSecondSave),
        );
        await waitFor(() => expect(mockedClient.updateDynamicView).toHaveBeenCalled());
        const body = mockedClient.updateDynamicView.mock.calls[0][1];
        expect(body.template_sql).toBe("SELECT 3 FROM {view}");
        // Post-VERIFY: second Save's body MUST include FRESH columns_json from the second auto-Preview.
        // (The first Save's columns are stale relative to the changed template; the auto-Preview
        // re-fetches.)
        expect(body).toHaveProperty("columns_json");
        expect(body.columns_json).toEqual([{ name: "c", type: "TEXT" }]);
      });
    });

    // ----- S11: AbortController cancels mid-Save on modal close -----
    describe("S11: Save — closing modal mid-Save aborts saveAbortRef signal", () => {
      it("unmounting modal during pending Save flips saveAbortRef.signal.aborted to true", async () => {
        setupAuth("alice");
        let capturedSignal: AbortSignal | undefined;
        mockedClient.createDynamicView.mockImplementationOnce((_dashboardId, _body, signal) => {
          capturedSignal = signal;
          return new Promise(() => {}); // never resolves
        });
        const { unmount } = render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={() => {}} />,
        );
        await screen.findByText("No dynamic views yet.");
        await fillNewForm("demo", "SELECT 1 FROM {view}");
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(capturedSignal).toBeDefined());
        expect(capturedSignal!.aborted).toBe(false);
        unmount();
        expect(capturedSignal!.aborted).toBe(true);
      });
    });

    // ----- D1: Dirty-state confirm — Cancel keeps modal open -----
    describe("D1: Dirty-state confirm — Cancel keeps modal open", () => {
      it("typing in name field → click Close → window.confirm shown → Cancel keeps modal open", async () => {
        setupAuth();
        const onClose = vi.fn();
        const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={onClose} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        const nameInput = await screen.findByPlaceholderText("Name your dynamic view");
        fireEvent.change(nameInput, { target: { value: "x" } });
        // Click Close → confirm fires; user cancels → onClose NOT called.
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved changes?");
        expect(onClose).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
      });
    });

    // ----- D2: Dirty-state confirm — Discard closes -----
    describe("D2: Dirty-state confirm — Discard closes the modal", () => {
      it("typing in name field → click Close → window.confirm shown → OK closes the modal", async () => {
        setupAuth();
        const onClose = vi.fn();
        const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={onClose} />,
        );
        await screen.findByText("No dynamic views yet.");
        fireEvent.click(screen.getByRole("button", { name: /\+ New dynamic view/i }));
        const nameInput = await screen.findByPlaceholderText("Name your dynamic view");
        fireEvent.change(nameInput, { target: { value: "x" } });
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(confirmSpy).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
        confirmSpy.mockRestore();
      });
    });

    // ----- D3: Save success clears isDirty -----
    describe("D3: Save success clears isDirty (subsequent Close skips confirm)", () => {
      it("Save success → window.confirm NOT shown on next Close click", async () => {
        setupAuth("alice");
        mockedClient.createDynamicView.mockResolvedValue({
          dynamic_view: makeRow(42, "demo"),
        });
        mockedClient.materializeDynamicView.mockResolvedValue({
          status: "materialized",
          view_name: "_kbi_dv_ualice_d5_42",
          row_count: 1,
          expires_at: 0,
        });
        const onClose = vi.fn();
        const confirmSpy = vi.spyOn(window, "confirm");
        render(
          <DynamicViewsModal dashboardId={5} associatedTables={multiTables} onClose={onClose} />,
        );
        await screen.findByText("No dynamic views yet.");
        await fillNewForm("demo", "SELECT 1 FROM {view}");
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(mockedClient.createDynamicView).toHaveBeenCalled());
        await waitFor(() => expect(mockedClient.materializeDynamicView).toHaveBeenCalled());
        // Allow setState to flush (isDirty=false after Save success).
        await waitFor(() => {
          const nameInput = screen.getByPlaceholderText(
            "Name your dynamic view",
          ) as HTMLInputElement;
          expect(nameInput.value).toBe("demo");
        });
        // Now click Close — isDirty should be false → no confirm prompt → onClose fires directly.
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
        confirmSpy.mockRestore();
      });
    });
  });
});
