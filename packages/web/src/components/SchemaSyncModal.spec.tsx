/**
 * SchemaSyncModal spec — Phase 126 Plan 02 (SSYNC-V125-01)
 *
 * The modal renders the check → report → apply stages of the schema-sync surface that
 * Phases 122-125 shipped server-side. Nothing here invents server behaviour: every
 * operator-facing sentence arrives in `response.message` (or, for the one string that
 * reaches no response body, from the guarded mirror in `../lib/schemaSyncStrings`).
 *
 * What each test-id prefix proves:
 *   NOPOLL-     the check is issued by a click and by nothing else (ROADMAP criterion 2).
 *               `NOPOLL-no-check-on-mount` is the DISCRIMINATING proof — the companion
 *               `setInterval` greps in the plan are prohibitions on code that never
 *               existed and cannot fail on their own.
 *   STAGE-      one stage transition each, driven by a resolved promise.
 *   ORDER-      the server's section order survives to the DOM untouched. Proves the
 *               ABSENCE of a second, divergable ordering implementation — which a
 *               prohibition grep cannot.
 *   VERBATIM-   server-authored prose reaches the DOM byte-identically.
 *   GAPS-       `knownGaps` is an array and is mapped, never indexed.
 *   ABSENT-     `impact`'s ABSENCE is the "not applicable" signal; it is never defaulted.
 *   NOAPPLY-    `table_missing` offers no Apply (there is no `live` map to echo back).
 *   CAVEAT-     the text-width caveat shows after a REAL apply and only then.
 *   CLASSNAME-  every className literal resolves to a real rule in global.css.
 *   HIST-       the sync-history tab: a DURABLE WORKLIST, readable without a check
 *               having run, one-click delete, and a cap notice that states the
 *               SERVER's cap. `NOPOLL-no-history-on-mount` is the history twin of
 *               `NOPOLL-no-check-on-mount` — without it a mount-effect history fetch
 *               would break ROADMAP criterion 2's spirit with nothing to catch it.
 *   TABS-       the tab selection lives OUTSIDE the Stage union, so reading history
 *               and coming back leaves the impact report intact. Folding `history`
 *               into `Stage` would destroy the report on every tab click.
 *
 * ── CLASSNAME-RESOLVES: STATED COVERAGE BOUNDARY ──────────────────────────────────────
 * The guard has two passes. Pass A reads className ATTRIBUTE VALUES. Pass B reads any
 * `impact-` / `schema-sync-`-prefixed token in any double-quoted string, which is how it
 * reaches the class strings returned from `severityClass()` — lines that carry no
 * `className` token and that Pass A structurally cannot see.
 *
 * A class token that is BOTH (a) written outside a className attribute AND (b) unprefixed
 * is invisible to BOTH passes. In this file that is exactly `text-danger` / `text-warning`
 * / `text-muted`, the three co-classes `severityClass()` appends. This is NOT covered and
 * is not dressed up as covered. The compensating control is that all three are
 * pre-existing (`global.css:150`, `:153`, `:156`), cited by line in the plan, and were not
 * invented here. Probe P7c exercises this boundary and is recorded as EXPECTED NOT TO
 * FIRE; do not "strengthen" a test to make it fire.
 *
 * The guard also does not cover template literals, `clsx` or array joins — which is
 * precisely why the plan forbids those idioms in this file and why a whole-file grep
 * enforces the convention the guard depends on.
 *
 * No fake timers anywhere: nothing here needs them and `test/setup.ts:52-66` already
 * handles both historical flake causes globally.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import SchemaSyncModal from "./SchemaSyncModal";
import * as clientModule from "../api/client";
import { SCHEMA_APPLY_TEXT_WIDTH_GAP } from "../lib/schemaSyncStrings";
import type {
  TableDto,
  ColumnFingerprintMap,
  ImpactColumn,
  ImpactRecord,
  ImpactReference,
  ImpactReport,
  ImpactSection,
  ImpactSeverity,
  SchemaApplyResult,
  SchemaCheckResponse,
  SyncChangeset,
  TableSyncHistory,
  TableSyncHistoryEntry,
} from "../api/client";

// ---------------------------------------------------------------------------
// Mock api/client — only the two schema-sync callers this plan uses
// ---------------------------------------------------------------------------
vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    checkTableSchema: vi.fn(),
    applyTableSchema: vi.fn(),
    listTableSyncHistory: vi.fn(),
    deleteTableSyncHistoryEntry: vi.fn(),
  };
});

const mockedClient = clientModule as unknown as {
  checkTableSchema: ReturnType<typeof vi.fn>;
  applyTableSchema: ReturnType<typeof vi.fn>;
  listTableSyncHistory: ReturnType<typeof vi.fn>;
  deleteTableSyncHistoryEntry: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Neutral synthetic fixtures — no dataset-specific names anywhere
// ---------------------------------------------------------------------------
const TABLE: TableDto = {
  id: 7,
  name: "synth_table",
  schema: "synth_schema",
  columns: { col_alpha: "int" },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const LIVE: ColumnFingerprintMap = {
  col_alpha: { base: "int", refinements: [] },
  col_beta: { base: "string", refinements: ["char32"] },
};

const CERTAINTY = "Exact match on a scoped configuration field.";
const ADVISORY = "Two widgets share this name; the id is shown instead.";
const STALE_TYPE = "This drill-down was frozen at type int and no longer matches.";
const LABEL = 'widget "Widget One" on dashboard "Dashboard One"';

const makeReference = (over?: Partial<ImpactReference>): ImpactReference => ({
  site: "widget.config.xAxis",
  path: "config.xAxis",
  confidence: "exact",
  tableScope: "scoped",
  certainty: CERTAINTY,
  matches: [],
  ...over,
});

const makeRecord = (over?: Partial<ImpactRecord>): ImpactRecord => ({
  recordKind: "widget",
  recordId: 1,
  name: "Widget One",
  dashboardName: "Dashboard One",
  displayLabel: LABEL,
  advisories: [],
  references: [makeReference()],
  ...over,
});

const makeColumn = (column: string, over?: Partial<ImpactColumn>): ImpactColumn => ({
  column,
  changeKind: "removed",
  storedType: "int",
  liveType: "string",
  storedClass: "numeric",
  liveClass: "text",
  summary: "Summary for " + column + " composed by the server.",
  records: [],
  ...over,
});

const makeSection = (severity: ImpactSeverity, columns: ImpactColumn[]): ImpactSection => ({
  severity,
  columns,
});

const THREE_SECTIONS: ImpactSection[] = [
  makeSection("breaking", [makeColumn("col_alpha")]),
  makeSection("changed", [makeColumn("col_beta", { changeKind: "retyped" })]),
  makeSection("harmless", [
    makeColumn("col_gamma", { changeKind: "added", storedType: null }),
  ]),
];

const makeReport = (over?: Partial<ImpactReport>): ImpactReport => ({
  v: 1,
  table: "synth_table",
  tableId: 7,
  outcome: "changes",
  sections: THREE_SECTIONS,
  advisorySummary: [],
  knownGaps: ["Known gap one, stated by the server."],
  ...over,
});

const makeDiffCheck = (
  impact: ImpactReport | undefined = makeReport(),
  hasChanges = true,
): SchemaCheckResponse => {
  const base = {
    outcome: "diff" as const,
    table: "synth_table",
    hasChanges,
    added: [],
    removed: [],
    retyped: [],
    live: LIVE,
  };
  return (impact === undefined ? base : { ...base, impact }) as SchemaCheckResponse;
};

const BASELINE_MESSAGE =
  "This table has no stored column baseline yet, so there is nothing to compare against.";
const MISSING_MESSAGE =
  "The table was not found in Kinetica, so no comparison could be made.";
const APPLIED_MESSAGE = "Applied: 1 column added, 2 removed, 1 retyped.";
const NO_CHANGES_MESSAGE =
  "Nothing to apply. No history entry was recorded, because nothing changed.";
const STALE_MESSAGE =
  "The live table changed while you were reading this report, so the apply was refused.";
const APPLY_MISSING_MESSAGE =
  "The table has disappeared from Kinetica since the check ran, so the apply was refused.";

const baselineCheck: SchemaCheckResponse = {
  outcome: "baseline_required",
  table: "synth_table",
  message: BASELINE_MESSAGE,
  live: LIVE,
};

const missingCheck: SchemaCheckResponse = {
  outcome: "table_missing",
  table: "synth_table",
  message: MISSING_MESSAGE,
};

const appliedResult: SchemaApplyResult = {
  outcome: "applied",
  kind: "diff",
  table: "synth_table",
  tableId: 7,
  recorded: true,
  historyId: 41,
  droppedThisApply: 0,
  columns: { col_alpha: "int" },
  changeset: null,
  message: APPLIED_MESSAGE,
};

const noChangesResult: SchemaApplyResult = {
  outcome: "no_changes",
  table: "synth_table",
  tableId: 7,
  message: NO_CHANGES_MESSAGE,
};

const staleResult: SchemaApplyResult = {
  outcome: "stale",
  table: "synth_table",
  tableId: 7,
  message: STALE_MESSAGE,
};

const applyMissingResult: SchemaApplyResult = {
  outcome: "table_missing",
  table: "synth_table",
  tableId: 7,
  message: APPLY_MISSING_MESSAGE,
};

// ---------------------------------------------------------------------------
// Sync-history fixtures — neutral synthetic names only
// ---------------------------------------------------------------------------
const HIST_TS = "2026-09-28T14:02:00Z";
const HIST_TS_LATER = "2026-09-28T15:30:00Z";
const HIST_TS_EARLY = "2026-09-20T08:00:00Z";
const HIST_TS_MID = "2026-09-24T11:45:00Z";
/** Anchored at BOTH ends so it matches the timestamp span and not its parent row. */
const TS_EXACT = /^2026-09-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const HIST_ACTOR = "opuser";

const makeChangeset = (over?: Partial<SyncChangeset>): SyncChangeset => ({
  v: 1,
  added: [{ column: "col_delta", liveType: "string" }],
  removed: [
    { column: "col_beta", storedType: "int" },
    { column: "col_gamma", storedType: "float" },
  ],
  retyped: [{ column: "col_alpha", storedType: "int", liveType: "string" }],
  ...over,
});

/**
 * The entry's stored report names col_epsilon and NOTHING else. col_epsilon appears
 * nowhere in the row summary and nowhere in the changeset, so HIST-expand structurally
 * cannot pass on the collapsed render.
 */
const REPORT_ONLY_COLUMN = "col_epsilon";

const historyReport: ImpactReport = makeReport({
  sections: [
    makeSection("breaking", [makeColumn(REPORT_ONLY_COLUMN)]),
    makeSection("changed", []),
    makeSection("harmless", []),
  ],
});

const makeEntry = (over?: Partial<TableSyncHistoryEntry>): TableSyncHistoryEntry => ({
  id: 41,
  table_id: 7,
  ts: HIST_TS,
  actor: HIST_ACTOR,
  kind: "diff",
  changeset: makeChangeset(),
  report: historyReport,
  ...over,
});

const makeHistory = (over?: Partial<TableSyncHistory>): TableSyncHistory => ({
  entries: [makeEntry()],
  droppedCount: 0,
  lastDroppedTs: null,
  cap: 20,
  ...over,
});

const BASELINE_DETAIL = "This was a baseline entry, so there was no changeset to record.";
const EMPTY_HISTORY_LINE = "No syncs recorded for this table yet.";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderModal() {
  const onClose = vi.fn();
  const utils = render(<SchemaSyncModal table={TABLE} onClose={onClose} />);
  return { ...utils, onClose };
}

const checkButton = () => screen.findByRole("button", { name: /check for changes/i });
const applyButton = () => screen.findByRole("button", { name: /^apply$/i });

const historyTab = () => screen.findByRole("button", { name: /^sync history$/i });
const checkTab = () => screen.findByRole("button", { name: /^schema check$/i });
const detailsButton = () => screen.findByRole("button", { name: /^details$/i });
const deleteButton = () => screen.findByRole("button", { name: /^delete$/i });

async function runCheck() {
  fireEvent.click(await checkButton());
}

async function openHistory() {
  fireEvent.click(await historyTab());
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockedClient.checkTableSchema.mockReset();
  mockedClient.applyTableSchema.mockReset();
  mockedClient.listTableSyncHistory.mockReset();
  mockedClient.deleteTableSyncHistoryEntry.mockReset();
  mockedClient.checkTableSchema.mockResolvedValue(makeDiffCheck());
  mockedClient.applyTableSchema.mockResolvedValue(appliedResult);
  mockedClient.listTableSyncHistory.mockResolvedValue(makeHistory());
  mockedClient.deleteTableSyncHistoryEntry.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("SchemaSyncModal — check / report / apply", () => {
  it("NOPOLL-no-check-on-mount: rendering the modal issues no schema-check request", async () => {
    renderModal();
    await checkButton();
    expect(mockedClient.checkTableSchema).toHaveBeenCalledTimes(0);
  });

  it("NOPOLL-check-on-click: the check runs once, on click, with the table id", async () => {
    renderModal();
    await runCheck();
    await screen.findAllByTestId("impact-severity");
    expect(mockedClient.checkTableSchema).toHaveBeenCalledTimes(1);
    expect(mockedClient.checkTableSchema).toHaveBeenCalledWith(TABLE.id);
  });

  it("STAGE-report-full: every finding renders, with no truncation control", async () => {
    renderModal();
    await runCheck();
    expect(await screen.findByText("col_alpha")).toBeInTheDocument();
    expect(screen.getByText("col_beta")).toBeInTheDocument();
    expect(screen.getByText("col_gamma")).toBeInTheDocument();
    expect(screen.queryByText(/show (more|all)/i)).toBeNull();
  });

  it("ORDER-no-client-sort: sections render in the order the server sent them", async () => {
    // Deliberately NOT the server's own breaking/changed/harmless order. A client-side
    // sort would re-impose that order and fail this assertion.
    const shuffled: ImpactSection[] = [
      THREE_SECTIONS[2],
      THREE_SECTIONS[1],
      THREE_SECTIONS[0],
    ];
    mockedClient.checkTableSchema.mockResolvedValue(
      makeDiffCheck(makeReport({ sections: shuffled })),
    );
    renderModal();
    await runCheck();
    const headings = await screen.findAllByTestId("impact-severity");
    expect(headings.map((h) => h.textContent)).toEqual(["harmless", "changed", "breaking"]);
  });

  it("VERBATIM-summary-and-label: server prose reaches the DOM byte-identically", async () => {
    const record = makeRecord({
      advisories: [{ kind: "ambiguous-name", message: ADVISORY }],
      staleDrillDownType: { frozenType: "int", message: STALE_TYPE },
    });
    mockedClient.checkTableSchema.mockResolvedValue(
      makeDiffCheck(
        makeReport({
          sections: [
            makeSection("breaking", [makeColumn("col_alpha", { records: [record] })]),
            makeSection("changed", []),
            makeSection("harmless", []),
          ],
        }),
      ),
    );
    renderModal();
    await runCheck();

    expect(
      await screen.findByText("Summary for col_alpha composed by the server."),
    ).toBeInTheDocument();
    expect(screen.getByText(LABEL)).toBeInTheDocument();
    expect(screen.getByText(CERTAINTY)).toBeInTheDocument();
    expect(screen.getByText(ADVISORY)).toBeInTheDocument();
    expect(screen.getByText(STALE_TYPE)).toBeInTheDocument();
  });

  it("GAPS-all: every knownGaps entry renders, not just the first", async () => {
    mockedClient.checkTableSchema.mockResolvedValue(
      makeDiffCheck(
        makeReport({ knownGaps: ["Known gap one, verbatim.", "Known gap two, verbatim."] }),
      ),
    );
    renderModal();
    await runCheck();
    expect(await screen.findByText("Known gap one, verbatim.")).toBeInTheDocument();
    expect(screen.getByText("Known gap two, verbatim.")).toBeInTheDocument();
  });

  it("ABSENT-impact-baseline: baseline_required renders its message, no report, and still offers Apply", async () => {
    mockedClient.checkTableSchema.mockResolvedValue(baselineCheck);
    renderModal();
    await runCheck();
    expect(await screen.findByText(BASELINE_MESSAGE)).toBeInTheDocument();
    expect(screen.queryAllByTestId("impact-severity")).toHaveLength(0);
    expect(await applyButton()).toBeInTheDocument();
  });

  it("NOAPPLY-table-missing: table_missing renders its message and offers no Apply", async () => {
    mockedClient.checkTableSchema.mockResolvedValue(missingCheck);
    renderModal();
    await runCheck();
    expect(await screen.findByText(MISSING_MESSAGE)).toBeInTheDocument();
    // Close proves the render reached the point at which Apply would have appeared.
    expect(screen.getByRole("button", { name: /^close$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^apply$/i })).toBeNull();
  });

  it("STAGE-apply-applied: Apply posts the check's own live map and renders the result message", async () => {
    renderModal();
    await runCheck();
    fireEvent.click(await applyButton());
    expect(await screen.findByText(APPLIED_MESSAGE)).toBeInTheDocument();
    expect(mockedClient.applyTableSchema).toHaveBeenCalledTimes(1);
    expect(mockedClient.applyTableSchema.mock.calls[0][0]).toBe(TABLE.id);
    expect(mockedClient.applyTableSchema.mock.calls[0][1]).toEqual(LIVE);
  });

  it("CAVEAT-applied: the text-width caveat renders after a real apply", async () => {
    renderModal();
    await runCheck();
    fireEvent.click(await applyButton());
    expect(await screen.findByText(SCHEMA_APPLY_TEXT_WIDTH_GAP)).toBeInTheDocument();
  });

  it("CAVEAT-no-changes: a no_changes apply renders its message AND the caveat (UAT-126-G8)", async () => {
    mockedClient.applyTableSchema.mockResolvedValue(noChangesResult);
    renderModal();
    await runCheck();
    fireEvent.click(await applyButton());
    expect(await screen.findByText(NO_CHANGES_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText(SCHEMA_APPLY_TEXT_WIDTH_GAP)).toBeInTheDocument();
  });

  it("CAVEAT-not-on-stale: a stale refusal wrote nothing and shows no caveat", async () => {
    mockedClient.applyTableSchema.mockResolvedValue(staleResult);
    renderModal();
    await runCheck();
    fireEvent.click(await applyButton());
    // The Re-check button proves the stale body rendered, so this cannot pass by rendering nothing.
    expect(await screen.findByRole("button", { name: "Re-check" })).toBeInTheDocument();
    expect(screen.queryByText(SCHEMA_APPLY_TEXT_WIDTH_GAP)).toBeNull();
  });

  it("STAGE-stale-recheck: a 409 stale shows the refusal plus a Re-check that re-runs in place", async () => {
    mockedClient.checkTableSchema
      .mockResolvedValueOnce(makeDiffCheck())
      .mockResolvedValueOnce(
        makeDiffCheck(
          makeReport({
            sections: [
              makeSection("breaking", [makeColumn("col_delta")]),
              makeSection("changed", []),
              makeSection("harmless", []),
            ],
          }),
        ),
      );
    mockedClient.applyTableSchema.mockResolvedValue(staleResult);

    renderModal();
    await runCheck();
    fireEvent.click(await applyButton());
    expect(await screen.findByText(STALE_MESSAGE)).toBeInTheDocument();

    // The modal must NOT silently re-check: the operator has to see reality moved.
    expect(mockedClient.checkTableSchema).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /re-check/i }));
    expect(await screen.findByText("col_delta")).toBeInTheDocument();
    expect(mockedClient.checkTableSchema).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByText(STALE_MESSAGE)).toBeNull());
  });

  it("STAGE-apply-tablemissing-409: a 409 table_missing apply renders its message and offers no Apply", async () => {
    mockedClient.applyTableSchema.mockResolvedValue(applyMissingResult);
    renderModal();
    await runCheck();
    fireEvent.click(await applyButton());
    expect(await screen.findByText(APPLY_MISSING_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^apply$/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sync history — the durable worklist (SSYNC-V125-18)
// ---------------------------------------------------------------------------
describe("SchemaSyncModal — sync history", () => {
  it("NOPOLL-no-history-on-mount: rendering the modal issues no sync-history request", async () => {
    renderModal();
    // Awaiting a control proves the render completed — this cannot pass on an empty DOM.
    await checkButton();
    expect(mockedClient.listTableSyncHistory).toHaveBeenCalledTimes(0);
  });

  it("HIST-loads-without-check: history renders without a check ever having run", async () => {
    renderModal();
    await openHistory();
    expect(await screen.findByText(HIST_ACTOR)).toBeInTheDocument();
    expect(mockedClient.listTableSyncHistory).toHaveBeenCalledTimes(1);
    expect(mockedClient.listTableSyncHistory).toHaveBeenCalledWith(TABLE.id);
    // The durable-worklist property: the operator opens this to work entries off, and
    // must not be forced through a check first.
    expect(mockedClient.checkTableSchema).toHaveBeenCalledTimes(0);
  });

  it("HIST-row-summary: a diff row states its timestamp, actor and 1/2/1 counts", async () => {
    renderModal();
    await openHistory();
    expect(await screen.findByText(HIST_TS)).toBeInTheDocument();
    expect(screen.getByText(HIST_ACTOR)).toBeInTheDocument();
    expect(screen.getByText("1 added, 2 removed, 1 retyped")).toBeInTheDocument();
  });

  it("HIST-order-as-given: rows render in the ARRAY order the server sent, not by ts", async () => {
    // Added in task 2 as the STRENGTHENING for probe P8, which was written expecting not
    // to fire and did not: no existing test rendered more than one entry, so a
    // client-side `.sort((a, b) => a.ts.localeCompare(b.ts))` passed unnoticed.
    //
    // The array order below is MID, LATE, EARLY — deliberately not monotonic in ts, so
    // NEITHER an ascending NOR a descending client re-sort can reproduce it. Two entries
    // were not enough: any two-element array is already sorted in one of the two
    // directions, which is exactly why the first version of this test still let P8 pass.
    mockedClient.listTableSyncHistory.mockResolvedValue(
      makeHistory({
        entries: [
          makeEntry({ id: 43, ts: HIST_TS_MID }),
          makeEntry({ id: 42, ts: HIST_TS_LATER }),
          makeEntry({ id: 41, ts: HIST_TS_EARLY }),
        ],
      }),
    );
    renderModal();
    await openHistory();
    const stamps = await screen.findAllByText(TS_EXACT);
    expect(stamps).toHaveLength(3);
    expect(stamps.map((stamp) => stamp.textContent)).toEqual([
      HIST_TS_MID,
      HIST_TS_LATER,
      HIST_TS_EARLY,
    ]);
  });

  it("HIST-expand: the changeset and the stored report appear ONLY after expanding", async () => {
    renderModal();
    await openHistory();
    await screen.findByText(HIST_ACTOR);
    // col_epsilon exists only inside entry.report; col_delta only inside the changeset.
    expect(screen.queryByText(REPORT_ONLY_COLUMN)).toBeNull();
    expect(screen.queryByText("col_delta")).toBeNull();

    fireEvent.click(await detailsButton());

    expect(await screen.findByText(REPORT_ONLY_COLUMN)).toBeInTheDocument();
    expect(screen.getByText("col_delta")).toBeInTheDocument();
    expect(screen.getByText("col_gamma")).toBeInTheDocument();
  });

  it("HIST-expand-baseline: a baseline entry (null changeset, null report) expands cleanly", async () => {
    mockedClient.listTableSyncHistory.mockResolvedValue(
      makeHistory({
        entries: [makeEntry({ kind: "baseline", changeset: null, report: null })],
      }),
    );
    renderModal();
    await openHistory();
    expect(await screen.findByText("Baseline established")).toBeInTheDocument();

    fireEvent.click(await detailsButton());

    expect(await screen.findByText(BASELINE_DETAIL)).toBeInTheDocument();
    // The row survived the expansion rather than blowing the subtree away.
    expect(screen.getByText(HIST_ACTOR)).toBeInTheDocument();
  });

  it("HIST-cap-notice: the notice states the SERVER's cap, never a hardcoded 20", async () => {
    // cap is deliberately 5. A hardcoded 20 renders "Showing the 20 most recent" and fails.
    mockedClient.listTableSyncHistory.mockResolvedValue(
      makeHistory({ droppedCount: 3, cap: 5 }),
    );
    renderModal();
    await openHistory();
    const notice = await screen.findByTestId("schema-sync-cap-notice");
    expect(notice.textContent).toBe("Showing the 5 most recent. 3 older entries were dropped.");
  });

  it("HIST-cap-notice-absent: droppedCount 0 renders no cap notice at all", async () => {
    mockedClient.listTableSyncHistory.mockResolvedValue(
      makeHistory({ droppedCount: 0, cap: 5 }),
    );
    renderModal();
    await openHistory();
    // The entries ARE present, so the render reached the point the notice would occupy.
    expect(await screen.findByText(HIST_ACTOR)).toBeInTheDocument();
    expect(screen.queryByTestId("schema-sync-cap-notice")).toBeNull();
  });

  it("HIST-delete: Delete passes BOTH the table id and the entry id, and the row goes", async () => {
    renderModal();
    await openHistory();
    expect(await screen.findByText(HIST_TS)).toBeInTheDocument();

    fireEvent.click(await deleteButton());

    await waitFor(() => expect(screen.queryByText(HIST_TS)).toBeNull());
    expect(mockedClient.deleteTableSyncHistoryEntry).toHaveBeenCalledTimes(1);
    // The table id in the path is load-bearing: the server 404s an entry that belongs
    // to a different table (index.ts:2691-2695).
    expect(mockedClient.deleteTableSyncHistoryEntry.mock.calls[0][0]).toBe(TABLE.id);
    expect(mockedClient.deleteTableSyncHistoryEntry.mock.calls[0][1]).toBe(41);
  });

  it("HIST-delete-no-confirm: one click deletes — no confirm dialog stands in the way", async () => {
    // A confirm() returning false would suppress the delete. This fails the moment one
    // is added: an entry is an audit note being ticked off, not data being destroyed.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      renderModal();
      await openHistory();
      expect(await screen.findByText(HIST_TS)).toBeInTheDocument();

      fireEvent.click(await deleteButton());

      await waitFor(() =>
        expect(mockedClient.deleteTableSyncHistoryEntry).toHaveBeenCalledTimes(1),
      );
      expect(confirmSpy).toHaveBeenCalledTimes(0);
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("HIST-refetch-after-apply: a successful apply refreshes history without reopening the modal", async () => {
    mockedClient.listTableSyncHistory
      .mockResolvedValueOnce(makeHistory())
      .mockResolvedValue(
        makeHistory({ entries: [makeEntry({ id: 42, ts: HIST_TS_LATER }), makeEntry()] }),
      );

    renderModal();
    await openHistory();
    expect(await screen.findByText(HIST_TS)).toBeInTheDocument();
    expect(screen.queryByText(HIST_TS_LATER)).toBeNull();
    expect(mockedClient.listTableSyncHistory).toHaveBeenCalledTimes(1);

    fireEvent.click(await checkTab());
    await runCheck();
    fireEvent.click(await applyButton());
    expect(await screen.findByText(APPLIED_MESSAGE)).toBeInTheDocument();

    // No tab click has happened since — the second call came from the apply path itself.
    await waitFor(() => expect(mockedClient.listTableSyncHistory).toHaveBeenCalledTimes(2));

    fireEvent.click(await historyTab());
    expect(await screen.findByText(HIST_TS_LATER)).toBeInTheDocument();
  });

  it("HIST-empty: a table with no syncs renders a neutral line and no cap notice", async () => {
    mockedClient.listTableSyncHistory.mockResolvedValue({
      entries: [],
      droppedCount: 0,
      lastDroppedTs: null,
      cap: 20,
    });
    renderModal();
    await openHistory();
    expect(await screen.findByText(EMPTY_HISTORY_LINE)).toBeInTheDocument();
    expect(screen.queryByTestId("schema-sync-cap-notice")).toBeNull();
  });

  it("TABS-report-survives-switch: reading history and returning leaves the report intact", async () => {
    // The tab lives OUTSIDE the Stage union. Folding `history` into Stage would drop the
    // operator back to idle here, and a re-check would be needed to see the report again.
    renderModal();
    await runCheck();
    expect(await screen.findByText("col_alpha")).toBeInTheDocument();

    fireEvent.click(await historyTab());
    expect(await screen.findByText(HIST_ACTOR)).toBeInTheDocument();
    expect(screen.queryByText("col_alpha")).toBeNull();

    fireEvent.click(await checkTab());
    expect(await screen.findByText("col_alpha")).toBeInTheDocument();
    expect(mockedClient.checkTableSchema).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// CLASSNAME-RESOLVES — static source guard (see the header comment's boundary note)
// ---------------------------------------------------------------------------
describe("CLASSNAME-RESOLVES: every className literal resolves to a rule in global.css", () => {
  const MODAL_SOURCE = readFileSync(
    resolve(process.cwd(), "src/components/SchemaSyncModal.tsx"),
    "utf-8",
  );
  const GLOBAL_CSS = readFileSync(
    resolve(process.cwd(), "src/styles/global.css"),
    "utf-8",
  );

  const resolvesInCss = (token: string): boolean =>
    new RegExp("\\." + token + "(?![\\w-])").test(GLOBAL_CSS);

  // Pass A: className ATTRIBUTE VALUES only. Value-only capture is deliberate — an
  // earlier draft scanned whole lines containing `className` and over-collected sibling
  // attributes (`type="button"` → the token `button`, which reads 0 in global.css).
  // Do NOT widen it back.
  const PLAIN = /className="([^"]*)"/g;
  const TERNARY = /className=\{[^}]*\?\s*"([^"]*)"\s*:\s*"([^"]*)"\s*\}/g;
  // Pass B: this phase's own prefixes, in ANY double-quoted string — reaches the class
  // strings returned from severityClass(), which carry no className token.
  const ANY_STRING = /"([^"\n]*)"/g;

  const CLASS_TOKEN = /^[a-z][a-z0-9-]*$/;
  const PHASE_PREFIXED = /^(impact|schema-sync)-[a-z0-9-]*$/;

  const collect = (groups: string[], keep: RegExp, into: Set<string>) => {
    for (const group of groups) {
      for (const token of group.split(/\s+/)) {
        if (keep.test(token)) into.add(token);
      }
    }
  };

  it("CLASSNAME-RESOLVES Pass A — className attribute values", () => {
    const passA = new Set<string>();
    for (const m of MODAL_SOURCE.matchAll(PLAIN)) collect([m[1]], CLASS_TOKEN, passA);
    for (const m of MODAL_SOURCE.matchAll(TERNARY)) {
      collect([m[1], m[2]], CLASS_TOKEN, passA);
    }

    // Floor: without it, a regex that matched nothing would assert over an empty set.
    expect(
      passA.size,
      "Pass A collected suspiciously few className tokens — the extractor is probably " +
        "broken, or the component stopped using plain double-quoted className literals.",
    ).toBeGreaterThanOrEqual(12);

    expect(
      [...passA].filter((t) => !resolvesInCss(t)),
      "className token(s) with no matching rule in global.css. An invented class renders " +
        "as unstyled browser chrome and passes tsc, vitest AND theme-guard.",
    ).toEqual([]);
  });

  it("CLASSNAME-RESOLVES Pass B — impact- / schema-sync- prefixed tokens anywhere", () => {
    const passB = new Set<string>();
    for (const m of MODAL_SOURCE.matchAll(ANY_STRING)) {
      collect([m[1]], PHASE_PREFIXED, passB);
    }

    expect(
      passB.size,
      "Pass B collected suspiciously few prefixed tokens — this phase's own classes " +
        "should all be visible here, including the ones severityClass() returns.",
    ).toBeGreaterThanOrEqual(8);

    expect(
      [...passB].filter((t) => !resolvesInCss(t)),
      "Prefixed class token(s) with no matching rule in global.css.",
    ).toEqual([]);
  });
});
