/**
 * ColumnFormatEditorModal spec — Phase 76 Plan 01 + Phase 85 Plan 01
 *
 * Coverage:
 *   T1 — renders label input with placeholder = raw column name (COLEDIT-V115-02)
 *   T2 — typing a label updates input; clearing leaves empty with raw-name placeholder (COLEDIT-V115-02 clear-reverts)
 *   T3 — switching kind to Number shows decimals + percent controls (COLEDIT-V115-03 kind switching)
 *   T4 — switching kind to Date shows preset dropdown (COLEDIT-V115-03 date kind)
 *   T5 — switching kind to Advanced shows specifier input + ×100 hint (COLEDIT-V115-03 d3 kind)
 *   T6 — live preview text changes when a control changes (COLEDIT-V115-03 live preview)
 *   T7 — Save button disabled when clean; enabled when dirty (COLEDIT-V115-03 save-gating)
 *   T8 — editing label + format then Save calls upsertColumnDisplayConfig + upsertColumn (COLEDIT-V115-03 persist)
 *   T9 — kind "none" + empty label → Save calls deleteColumnDisplayConfig + removeColumn
 *   T10 — rejected upsert fires error toast; modal stays open; isDirty preserved
 *   T11 — switching kind to Smart abbreviation shows decimal-places control + SI live preview (FMT-V117-02)
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import ColumnFormatEditorModal from "./ColumnFormatEditorModal";
import * as clientModule from "../api/client";
import type { TableDto } from "../api/client";
import { useColumnDisplayConfigStore } from "../store/columnDisplayConfigStore";
import { useToastStore } from "../store/toast";

// ---------------------------------------------------------------------------
// Mock api/client — listColumnDisplayConfig returns empty; upsert/delete controlled per test
// ---------------------------------------------------------------------------
vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    listColumnDisplayConfig: vi.fn(),
    upsertColumnDisplayConfig: vi.fn(),
    deleteColumnDisplayConfig: vi.fn(),
  };
});

const mockedClient = clientModule as unknown as {
  listColumnDisplayConfig: ReturnType<typeof vi.fn>;
  upsertColumnDisplayConfig: ReturnType<typeof vi.fn>;
  deleteColumnDisplayConfig: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Fixture table
// ---------------------------------------------------------------------------
const makeTable = (overrides?: Partial<TableDto>): TableDto => ({
  id: 42,
  name: "test_table",
  schema: "public",
  columns: { revenue: "DOUBLE", created_at: "TIMESTAMP", label_col: "VARCHAR" },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const TABLE = makeTable();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderModal(table: TableDto = TABLE) {
  const onClose = vi.fn();
  const utils = render(
    <ColumnFormatEditorModal table={table} onClose={onClose} />,
  );
  return { ...utils, onClose };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockedClient.listColumnDisplayConfig.mockResolvedValue([]);
  mockedClient.upsertColumnDisplayConfig.mockResolvedValue({
    table_id: 42,
    column_name: "revenue",
    label: null,
    format_spec: null,
    created_at: "",
    updated_at: "",
  });
  mockedClient.deleteColumnDisplayConfig.mockResolvedValue(undefined);
  useColumnDisplayConfigStore.getState().reset();
});

// ---------------------------------------------------------------------------
// T1: label input placeholder = raw column name
// ---------------------------------------------------------------------------
describe("ColumnFormatEditorModal", () => {
  it("T1: renders label input with placeholder = raw column name", async () => {
    renderModal();

    // Wait for load
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /revenue/i })).toBeInTheDocument();
    });

    // Auto-selects first column (revenue)
    const labelInput = screen.getByRole("textbox", { name: /display label/i });
    expect(labelInput).toHaveAttribute("placeholder", "revenue");
    expect(labelInput).toHaveValue("");
  });

  // ---------------------------------------------------------------------------
  // T2: typing a label + clearing reverts to raw name placeholder
  // ---------------------------------------------------------------------------
  it("T2: typing a label updates input; clearing leaves empty (placeholder = raw name)", async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /revenue/i })).toBeInTheDocument();
    });

    const labelInput = screen.getByRole("textbox", { name: /display label/i });

    // Type a label
    fireEvent.change(labelInput, { target: { value: "My Revenue" } });
    expect(labelInput).toHaveValue("My Revenue");

    // Clear it
    fireEvent.change(labelInput, { target: { value: "" } });
    expect(labelInput).toHaveValue("");
    expect(labelInput).toHaveAttribute("placeholder", "revenue");
  });

  // ---------------------------------------------------------------------------
  // T3: switching kind to Number shows decimals + percent controls
  // ---------------------------------------------------------------------------
  it("T3: switching kind to Number shows decimals + percent controls", async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /revenue/i })).toBeInTheDocument();
    });

    const kindSelect = screen.getByRole("combobox", { name: /format kind/i });

    // Columns default to "none" (no inferred kind); switching to Number reveals controls
    fireEvent.change(kindSelect, { target: { value: "number" } });

    expect(screen.getByRole("spinbutton", { name: /decimal places/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /percent/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /thousands separator/i })).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // T4: switching kind to Date shows preset dropdown
  // ---------------------------------------------------------------------------
  it("T4: switching kind to Date shows preset dropdown", async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /revenue/i })).toBeInTheDocument();
    });

    const kindSelect = screen.getByRole("combobox", { name: /format kind/i });
    fireEvent.change(kindSelect, { target: { value: "date" } });

    // Should show the date preset dropdown
    expect(screen.getByRole("combobox", { name: /date preset/i })).toBeInTheDocument();

    // Should show all 6 preset options
    const presetSelect = screen.getByRole("combobox", { name: /date preset/i });
    const options = Array.from((presetSelect as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toContain("iso");
    expect(options).toContain("us");
    expect(options).toContain("long");
    expect(options).toContain("us_time");
    expect(options).toContain("long_time");
    expect(options).toContain("custom");
  });

  // ---------------------------------------------------------------------------
  // T5: switching kind to Advanced shows specifier input + ×100 hint
  // ---------------------------------------------------------------------------
  it("T5: switching kind to Advanced shows specifier input + ×100 hint", async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /revenue/i })).toBeInTheDocument();
    });

    const kindSelect = screen.getByRole("combobox", { name: /format kind/i });
    fireEvent.change(kindSelect, { target: { value: "d3" } });

    expect(screen.getByRole("textbox", { name: /d3 specifier/i })).toBeInTheDocument();
    // Check for ×100 hint
    expect(screen.getByText(/multiplies by 100/i)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // T6: live preview changes when a control changes
  // ---------------------------------------------------------------------------
  it("T6: live preview text updates when a control changes", async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /revenue/i })).toBeInTheDocument();
    });

    const kindSelect = screen.getByRole("combobox", { name: /format kind/i });
    // Switch to number
    fireEvent.change(kindSelect, { target: { value: "number" } });

    const preview = screen.getByTestId("live-preview");
    const initialText = preview.textContent;

    // Toggle percent — preview should change
    const percentCheck = screen.getByRole("checkbox", { name: /percent/i });
    fireEvent.click(percentCheck);

    const afterText = screen.getByTestId("live-preview").textContent;
    expect(afterText).not.toBe(initialText);
    // Should end with %
    expect(afterText).toMatch(/%/);
  });

  // ---------------------------------------------------------------------------
  // T7: Save button disabled when clean; enabled after an edit
  // ---------------------------------------------------------------------------
  it("T7: Save button disabled when clean; enabled after an edit", async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /revenue/i })).toBeInTheDocument();
    });

    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).toBeDisabled();

    // Make an edit
    const labelInput = screen.getByRole("textbox", { name: /display label/i });
    fireEvent.change(labelInput, { target: { value: "Revenue Total" } });

    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
  });

  // ---------------------------------------------------------------------------
  // T8: Save calls upsertColumnDisplayConfig + upsertColumn on the store
  // ---------------------------------------------------------------------------
  it("T8: Save calls upsertColumnDisplayConfig + upsertColumn with correct args", async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /revenue/i })).toBeInTheDocument();
    });

    // Columns default to "none"; explicitly pick Number to exercise the number-save path
    const kindSelect = screen.getByRole("combobox", { name: /format kind/i });
    fireEvent.change(kindSelect, { target: { value: "number" } });

    // Edit label
    const labelInput = screen.getByRole("textbox", { name: /display label/i });
    fireEvent.change(labelInput, { target: { value: "My Revenue" } });

    const upsertStoreSpy = vi.spyOn(
      useColumnDisplayConfigStore.getState(),
      "upsertColumn",
    );

    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockedClient.upsertColumnDisplayConfig).toHaveBeenCalledWith(
        42,
        "revenue",
        "My Revenue",
        expect.objectContaining({ kind: "number" }),
      );
    });

    expect(upsertStoreSpy).toHaveBeenCalledWith(
      42,
      "revenue",
      "My Revenue",
      expect.objectContaining({ kind: "number" }),
    );
  });

  // ---------------------------------------------------------------------------
  // T9: kind "none" + empty label → deleteColumnDisplayConfig + removeColumn
  // ---------------------------------------------------------------------------
  it("T9: clearing a saved column (none kind + empty label) → deleteColumnDisplayConfig + removeColumn", async () => {
    // Seed revenue with an existing saved config so clearing it is a real change.
    // (Columns now default to "none"; the delete path is only reachable when a
    // previously-saved column is reset to none + empty label.)
    mockedClient.listColumnDisplayConfig.mockResolvedValue([
      {
        table_id: 42,
        column_name: "revenue",
        label: "Old Revenue",
        format_spec: { kind: "number", thousandsSep: true, decimals: 2, currency: false, percent: false },
        created_at: "",
        updated_at: "",
      },
    ]);

    renderModal();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /revenue/i })).toBeInTheDocument();
    });

    // Clear the label and switch the kind back to None → now differs from the saved baseline
    const labelInput = screen.getByRole("textbox", { name: /display label/i });
    fireEvent.change(labelInput, { target: { value: "" } });
    const kindSelect = screen.getByRole("combobox", { name: /format kind/i });
    fireEvent.change(kindSelect, { target: { value: "none" } });

    // Confirm Save is enabled (dirty vs the saved baseline)
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).not.toBeDisabled();

    const removeColSpy = vi.spyOn(
      useColumnDisplayConfigStore.getState(),
      "removeColumn",
    );

    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockedClient.deleteColumnDisplayConfig).toHaveBeenCalledWith(42, "revenue");
    });
    expect(removeColSpy).toHaveBeenCalledWith(42, "revenue");
  });

  // ---------------------------------------------------------------------------
  // T10: rejected upsert fires error toast; modal stays open; isDirty preserved
  // ---------------------------------------------------------------------------
  it("T10: rejected upsert fires error toast; modal stays open", async () => {
    mockedClient.upsertColumnDisplayConfig.mockRejectedValue(new Error("Server error"));

    const { onClose } = renderModal();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /revenue/i })).toBeInTheDocument();
    });

    // Make a change
    const labelInput = screen.getByRole("textbox", { name: /display label/i });
    fireEvent.change(labelInput, { target: { value: "Fail Revenue" } });

    const showToastSpy = vi.spyOn(useToastStore.getState(), "showToast");

    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(showToastSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to save"),
        "error",
      );
    });

    // Modal still open
    expect(onClose).not.toHaveBeenCalled();

    // Save button still enabled (isDirty preserved)
    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
  });

  // ---------------------------------------------------------------------------
  // T11: switching kind to Smart abbreviation shows decimal-places control + SI live preview
  // ---------------------------------------------------------------------------
  it("T11: switching kind to Smart abbreviation shows decimal-places control + SI live preview", async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /revenue/i })).toBeInTheDocument();
    });

    const kindSelect = screen.getByRole("combobox", { name: /format kind/i });
    fireEvent.change(kindSelect, { target: { value: "si" } });

    // SIControls decimal-places input appears
    expect(screen.getByLabelText(/decimal places/i)).toBeInTheDocument();

    // Live preview renders SAMPLE_NUMBER (1234567.891) abbreviated at default decimals=1
    const preview = screen.getByTestId("live-preview");
    expect(preview).toHaveTextContent("1.2M");
  });
});
