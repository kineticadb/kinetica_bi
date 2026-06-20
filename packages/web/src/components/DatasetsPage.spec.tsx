import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock ColumnFormatEditorModal so DatasetsPage tests can assert button renders modal +
// props are passed correctly without pulling in the full editor tree.
// Capture props via globalThis.__lastCFEProps (mirrors DynamicViewsModal mock pattern).
vi.mock("./ColumnFormatEditorModal", () => ({
  __esModule: true,
  default: (props: { table: unknown; onClose: () => void }) => {
    (globalThis as unknown as { __lastCFEProps?: unknown }).__lastCFEProps = props;
    return <div data-testid="cfe-modal-stub" />;
  },
}));

// Mock the api/client module — stub listTables so DatasetsPage mounts with known data.
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    listTables: vi.fn(() =>
      Promise.resolve([
        {
          id: 42,
          name: "orders",
          schema: "public",
          description: "Order records",
          columns: { order_id: "int", amount: "double", placed_at: "datetime" },
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z",
        },
      ])
    ),
    fetchKineticaSchemas: vi.fn(() => Promise.resolve([])),
    fetchKineticaTables: vi.fn(() => Promise.resolve([])),
    fetchKineticaColumns: vi.fn(() => Promise.resolve({})),
    updateTable: vi.fn(() => Promise.resolve({})),
    deleteTableEntry: vi.fn(() => Promise.resolve()),
    createTableEntry: vi.fn(() => Promise.resolve({})),
  };
});

// Mock the columnDisplayConfigStore so loadConfig doesn't make real network calls.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TABLE_DTO = {
  id: 42,
  name: "orders",
  schema: "public",
  description: "Order records",
  columns: { order_id: "int", amount: "double", placed_at: "datetime" },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

async function renderAndNavigateToDetail() {
  render(<DatasetsPage />);
  // Wait for the table list to load.
  const viewButton = await screen.findByRole("button", { name: "View" });
  await userEvent.click(viewButton);
  // Wait for the detail screen header.
  await screen.findByText("orders");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("DatasetsPage — TableDetail", () => {
  beforeEach(() => {
    (globalThis as unknown as { __lastCFEProps?: unknown }).__lastCFEProps = undefined;
  });

  it("renders a 'Format columns' button on the TableDetail screen", async () => {
    await renderAndNavigateToDetail();
    const btn = screen.getByRole("button", { name: "Format columns" });
    expect(btn).toBeInTheDocument();
  });

  it("does NOT render ColumnFormatEditorModal before the button is clicked", async () => {
    await renderAndNavigateToDetail();
    expect(screen.queryByTestId("cfe-modal-stub")).not.toBeInTheDocument();
  });

  it("clicking 'Format columns' renders ColumnFormatEditorModal", async () => {
    await renderAndNavigateToDetail();
    const btn = screen.getByRole("button", { name: "Format columns" });
    await userEvent.click(btn);
    expect(screen.getByTestId("cfe-modal-stub")).toBeInTheDocument();
  });

  it("ColumnFormatEditorModal receives the selected table as the 'table' prop", async () => {
    await renderAndNavigateToDetail();
    const btn = screen.getByRole("button", { name: "Format columns" });
    await userEvent.click(btn);
    const props = (
      globalThis as unknown as {
        __lastCFEProps: { table: typeof TABLE_DTO; onClose: () => void };
      }
    ).__lastCFEProps;
    expect(props.table).toBeDefined();
    expect(props.table.id).toBe(TABLE_DTO.id);
    expect(props.table.name).toBe(TABLE_DTO.name);
  });

  it("ColumnFormatEditorModal receives an 'onClose' function prop", async () => {
    await renderAndNavigateToDetail();
    const btn = screen.getByRole("button", { name: "Format columns" });
    await userEvent.click(btn);
    const props = (
      globalThis as unknown as {
        __lastCFEProps: { table: typeof TABLE_DTO; onClose: () => void };
      }
    ).__lastCFEProps;
    expect(typeof props.onClose).toBe("function");
  });

  it("calling onClose hides the modal", async () => {
    await renderAndNavigateToDetail();
    const btn = screen.getByRole("button", { name: "Format columns" });
    await userEvent.click(btn);
    expect(screen.getByTestId("cfe-modal-stub")).toBeInTheDocument();
    const props = (
      globalThis as unknown as {
        __lastCFEProps: { table: typeof TABLE_DTO; onClose: () => void };
      }
    ).__lastCFEProps;
    // Call onClose — this should set showFormatEditor to false.
    await waitFor(() => props.onClose());
    await waitFor(() => {
      expect(screen.queryByTestId("cfe-modal-stub")).not.toBeInTheDocument();
    });
  });
});
