// Phase 126 Plan 04 (SSYNC-V125-01 / SSYNC-V125-19): the Datasets entry point for the
// schema-sync modal, and the client-side permission gate in front of it.
//
// THE GATE IS AN **AND**, and it is an ABSENCE gate.
// All four schema-sync routes spread requirePermission(DATASETS_MANAGE) AND
// requirePermission(DASHBOARDS_MANAGE_ACCESS) — packages/server/src/index.ts:2500-2501,
// :2577-2578, :2664-2665, :2682-2683. Gating the UI on only one of them would offer a control
// that the server answers with a 403, which is the exact UI/API disagreement ROADMAP Phase 126
// criterion 4 exists to prevent. CONTEXT is also explicit that the control must be ABSENT for a
// user missing either permission, never disabled — a disabled button still tells an unauthorised
// user the feature exists, and queryByRole would still find it.
//
// WHY EVERY NEGATIVE CASE ALSO ASSERTS AN UNGATED SIBLING IS PRESENT.
// `expect(queryByRole(...)).toBeNull()` passes just as happily when the component threw, when
// the list never loaded, or when TableDetail never mounted — i.e. it passes for the wrong reason.
// So each of GATE-neither / GATE-datasets-only / GATE-access-only additionally asserts that
// `Format columns` IS in the document, proving the render reached the very actions bar the
// schema-sync button would have appeared in. The precedent is
// DashboardsPage.exportimport.spec.tsx:202-208 (its probe A); this file is deliberately stronger
// than that file's other two negative cases, which carry no sibling assertion at all.
//
// GATE-ungated-siblings pins a second constraint as an executable assertion: DatasetsPage.spec.tsx
// never seeds the auth store, so gating ANY pre-existing control (Format columns, Custom metrics,
// Back, View, Edit, Delete) would redden all six of its tests. That test fails the moment anyone
// extends the gate to an existing control.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { seedPermissionsStore } from "../test/seedAuthStore";
import { PERMISSIONS } from "../lib/permissions";

// Stub the schema-sync modal so these tests never pull in the staged modal (plans 02/03) — the
// subject here is the entry point and the gate, nothing inside the modal. Props are captured on
// globalThis, mirroring DatasetsPage.spec.tsx:8-14's __lastCFEProps idiom.
vi.mock("./SchemaSyncModal", () => ({
  __esModule: true,
  default: (props: { table: unknown; onClose: () => void }) => {
    (globalThis as unknown as { __lastSchemaSyncProps?: unknown }).__lastSchemaSyncProps = props;
    return <div data-testid="schema-sync-modal-stub" />;
  },
}));

// The two pre-existing per-table modals are stubbed for the same reason: their buttons are the
// ungated siblings under test, their internals are not.
vi.mock("./ColumnFormatEditorModal", () => ({
  __esModule: true,
  default: () => <div data-testid="cfe-modal-stub" />,
}));
vi.mock("./CustomMetricsEditorModal", () => ({
  __esModule: true,
  default: () => <div data-testid="cme-modal-stub" />,
}));

// Neutral synthetic fixture — no real dataset names.
const TABLE_DTO = {
  id: 71,
  name: "table_alpha",
  schema: "schema_alpha",
  description: "",
  columns: { col_alpha: "int", col_beta: "double" },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    listTables: vi.fn(() => Promise.resolve([TABLE_DTO])),
    fetchKineticaSchemas: vi.fn(() => Promise.resolve([])),
    fetchKineticaTables: vi.fn(() => Promise.resolve([])),
    fetchKineticaColumns: vi.fn(() => Promise.resolve({})),
    updateTable: vi.fn(() => Promise.resolve({})),
    deleteTableEntry: vi.fn(() => Promise.resolve()),
    createTableEntry: vi.fn(() => Promise.resolve({})),
    checkTableSchema: vi.fn(() => Promise.resolve({})),
    listTableSyncHistory: vi.fn(() => Promise.resolve({})),
    // Default: /me reports the SAME permissions the store was seeded with, so the mount re-sync
    // is a no-op for every other test in this file. RESYNC-* overrides it per test.
    fetchMe: vi.fn(() => Promise.resolve(null)),
  };
});

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
import { checkTableSchema, listTableSyncHistory, fetchMe } from "../api/client";

const SCHEMA_SYNC = { name: /schema sync/i } as const;
const FORMAT_COLUMNS = { name: /format columns/i } as const;

/**
 * Renders the Datasets list, clicks the row's View button, and waits for TableDetail's own
 * chrome. "Created" is a ds-detail-label rendered ONLY by TableDetail, so awaiting it is a
 * render-reached proof that is independent of the actions bar — the bar itself is then proven
 * by each negative test's `Format columns` sibling assertion.
 */
async function navigateToDetail(): Promise<void> {
  render(<DatasetsPage />);
  await userEvent.click(await screen.findByRole("button", { name: "View" }));
  await screen.findByText("Created");
}

describe("DatasetsPage — schema-sync entry point and its AND-gate (Phase 126 Plan 04)", () => {
  beforeEach(() => {
    (globalThis as unknown as { __lastSchemaSyncProps?: unknown }).__lastSchemaSyncProps = undefined;
    (checkTableSchema as Mock).mockClear();
    (listTableSyncHistory as Mock).mockClear();
  });

  it("GATE-both: datasets:manage AND dashboards:manage_access sees the Schema sync control", async () => {
    // Seeded at the top of the test body, not at module scope: seedAuthStore.ts:1-10 requires the
    // zustand reset shim to have run first, and the previous test's afterEach is what runs it.
    // Same position as DashboardsPage.exportimport.spec.tsx uses for its own gate probes.
    seedPermissionsStore([PERMISSIONS.DATASETS_MANAGE, PERMISSIONS.DASHBOARDS_MANAGE_ACCESS]);
    await navigateToDetail();
    expect(await screen.findByRole("button", SCHEMA_SYNC)).toBeInTheDocument();
  });

  it("GATE-neither: no permissions sees NO Schema sync control, while Format columns IS present", async () => {
    seedPermissionsStore([]);
    await navigateToDetail();
    // The sibling assertion comes FIRST on purpose: it proves the actions bar rendered, so the
    // null below can only mean "gated", never "nothing rendered".
    expect(screen.getByRole("button", FORMAT_COLUMNS)).toBeInTheDocument();
    expect(screen.queryByRole("button", SCHEMA_SYNC)).toBeNull();
  });

  it("GATE-datasets-only: datasets:manage ALONE sees NO Schema sync control, while Format columns IS present", async () => {
    seedPermissionsStore([PERMISSIONS.DATASETS_MANAGE]);
    await navigateToDetail();
    expect(screen.getByRole("button", FORMAT_COLUMNS)).toBeInTheDocument();
    expect(screen.queryByRole("button", SCHEMA_SYNC)).toBeNull();
  });

  it("GATE-access-only: dashboards:manage_access ALONE sees NO Schema sync control, while Format columns IS present", async () => {
    seedPermissionsStore([PERMISSIONS.DASHBOARDS_MANAGE_ACCESS]);
    await navigateToDetail();
    expect(screen.getByRole("button", FORMAT_COLUMNS)).toBeInTheDocument();
    expect(screen.queryByRole("button", SCHEMA_SYNC)).toBeNull();
  });

  it("GATE-ungated-siblings: with NO permissions, Format columns, Custom metrics and Back are ALL still present", async () => {
    seedPermissionsStore([]);
    await navigateToDetail();
    expect(screen.getByRole("button", FORMAT_COLUMNS)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /custom metrics/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^back$/i })).toBeInTheDocument();
  });

  it("ENTRY-opens-modal: clicking Schema sync mounts the modal bound to THIS table", async () => {
    seedPermissionsStore([PERMISSIONS.DATASETS_MANAGE, PERMISSIONS.DASHBOARDS_MANAGE_ACCESS]);
    await navigateToDetail();
    expect(screen.queryByTestId("schema-sync-modal-stub")).toBeNull();
    await userEvent.click(await screen.findByRole("button", SCHEMA_SYNC));
    expect(await screen.findByTestId("schema-sync-modal-stub")).toBeInTheDocument();
    const props = (
      globalThis as unknown as {
        __lastSchemaSyncProps: { table: typeof TABLE_DTO; onClose: () => void };
      }
    ).__lastSchemaSyncProps;
    expect(props.table.id).toBe(TABLE_DTO.id);
    expect(props.table.name).toBe(TABLE_DTO.name);
    expect(typeof props.onClose).toBe("function");
  });

  it("ENTRY-closes: invoking the captured onClose removes the modal", async () => {
    seedPermissionsStore([PERMISSIONS.DATASETS_MANAGE, PERMISSIONS.DASHBOARDS_MANAGE_ACCESS]);
    await navigateToDetail();
    await userEvent.click(await screen.findByRole("button", SCHEMA_SYNC));
    expect(await screen.findByTestId("schema-sync-modal-stub")).toBeInTheDocument();
    const props = (
      globalThis as unknown as { __lastSchemaSyncProps: { onClose: () => void } }
    ).__lastSchemaSyncProps;
    await waitFor(() => props.onClose());
    await waitFor(() => {
      expect(screen.queryByTestId("schema-sync-modal-stub")).toBeNull();
    });
  });

  // Operator finding at Phase 126's verification checkpoint, and the reason this block exists.
  //
  // Client permissions are set at login and refreshed in exactly ONE other place: App.tsx's
  // PERMISSION_DENIED_EVENT listener, dispatched only from api/client.ts's 403 handler. The
  // client therefore learns about a permission LOSS but never about a mid-session GRANT.
  //
  // Before this phase that was invisible, because Datasets gated nothing client-side: a control
  // rendered, the user clicked, the server said 403, the event fired, /me re-synced. The
  // reactive path worked BECAUSE nothing was hidden. `Schema sync` is hidden, so it can never
  // be clicked, can never produce a 403, and the gate seals itself shut — an operator granted
  // both permissions mid-session saw nothing until re-login. No automated gate caught this;
  // a human looking at the screen did.
  it("RESYNC-grant: a mid-session GRANT reaches the gate without a re-login", async () => {
    // The store is STALE: it holds only datasets:manage, as it would after logging in before
    // the role was edited. The server now reports BOTH.
    seedPermissionsStore([PERMISSIONS.DATASETS_MANAGE]);
    (fetchMe as Mock).mockResolvedValueOnce({
      user: { username: "u_alpha", roles: ["role_alpha"], permissions: [PERMISSIONS.DATASETS_MANAGE, PERMISSIONS.DASHBOARDS_MANAGE_ACCESS] },
      authMode: "password",
      ttlKeepaliveLeadMinutes: 1,
      maxCombinationViewsPerTable: 10,
      dvFilterScopeDisabled: false,
      maxBarGroupBySeriesCap: 10,
    });
    await navigateToDetail();
    // Appears WITHOUT a re-login. Before the fix this was null.
    expect(await screen.findByRole("button", SCHEMA_SYNC)).toBeInTheDocument();
  });

  it("RESYNC-revoke: a mid-session REVOKE also reaches the gate, and the sibling stays", async () => {
    // The inverse, so the re-sync cannot be a one-way "always grant" that happens to pass the
    // test above. Store says both; the server says the access permission is gone.
    seedPermissionsStore([PERMISSIONS.DATASETS_MANAGE, PERMISSIONS.DASHBOARDS_MANAGE_ACCESS]);
    (fetchMe as Mock).mockResolvedValueOnce({
      user: { username: "u_alpha", roles: ["role_alpha"], permissions: [PERMISSIONS.DATASETS_MANAGE] },
      authMode: "password",
      ttlKeepaliveLeadMinutes: 1,
      maxCombinationViewsPerTable: 10,
      dvFilterScopeDisabled: false,
      maxBarGroupBySeriesCap: 10,
    });
    await navigateToDetail();
    await waitFor(() => expect(screen.queryByRole("button", SCHEMA_SYNC)).toBeNull());
    // Ungated sibling still present — proves the render reached the actions bar rather than
    // the whole detail view having failed, which would make the null assertion meaningless.
    expect(screen.getByRole("button", FORMAT_COLUMNS)).toBeInTheDocument();
  });

  it("RESYNC-failure-is-silent: a failing /me leaves the page and the existing gate intact", async () => {
    // A failed /me must never blank the Datasets page or revoke the control the store already
    // knows about. Mirrors App.tsx's own .catch(() => {}).
    seedPermissionsStore([PERMISSIONS.DATASETS_MANAGE, PERMISSIONS.DASHBOARDS_MANAGE_ACCESS]);
    (fetchMe as Mock).mockRejectedValueOnce(new Error("network down"));
    await navigateToDetail();
    expect(await screen.findByRole("button", SCHEMA_SYNC)).toBeInTheDocument();
    expect(screen.getByRole("button", FORMAT_COLUMNS)).toBeInTheDocument();
  });

  it("NOPOLL-datasets-page: opening Datasets and a table's detail issues ZERO schema-check requests", async () => {
    // ROADMAP Phase 126 criterion 2: no check fires until the operator asks for one inside the
    // modal. The modal's own NOPOLL twins guard its mount; this one guards the page around it.
    seedPermissionsStore([PERMISSIONS.DATASETS_MANAGE, PERMISSIONS.DASHBOARDS_MANAGE_ACCESS]);
    await navigateToDetail();
    expect(await screen.findByRole("button", SCHEMA_SYNC)).toBeInTheDocument();
    expect(checkTableSchema).toHaveBeenCalledTimes(0);
    expect(listTableSyncHistory).toHaveBeenCalledTimes(0);
  });
});
