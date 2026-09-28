/**
 * SchemaSyncModal — Phase 126 Plan 02 (SSYNC-V125-01)
 *
 * The check → report → apply stages AND the sync-history tab of the per-table
 * schema-sync modal. The entry point that mounts it (and the permission gate in front
 * of it) is plan 04's.
 *
 * The tab selection is a SIBLING useState, deliberately NOT a Stage arm: every Stage arm
 * carries a check/apply payload and a history tab carries none. Keeping it outside is
 * also what makes the impact report survive a tab switch (TABS-report-survives-switch) —
 * the operator reads the history, comes back, and the report is still there.
 *
 * The history is a DURABLE WORKLIST, not a modal artefact. Hence: it loads without a
 * check having run, a row expands in place rather than linking away, and Delete takes one
 * click with no confirm — an entry is an audit note being ticked off.
 *
 * Three rules this file obeys, each with a reason:
 *
 * 1. NO fetch on mount, no interval, no polling. `checkTableSchema`, `applyTableSchema`
 *    and `listTableSyncHistory` are called from click handlers (and, for the history, from
 *    the apply handler once an apply has actually landed) and from nowhere else
 *    (ROADMAP Phase 126 criterion 2).
 *
 * 2. Server prose is rendered VERBATIM and never re-derived. `record.displayLabel` already
 *    carries its own noun; `column.summary`, `reference.certainty`, `advisory.message`,
 *    `record.staleDrillDownType.message` and every entry of `report.knownGaps` are composed
 *    server-side and carry a "rendered VERBATIM" doc-comment there. Likewise ORDER: the
 *    server always emits exactly three sections in breaking / changed / harmless order with
 *    columns sorted byte-ascending inside each. This file maps them AS GIVEN. No .sort, no
 *    .filter, no severity lookup that could reorder — a client sort would be a second,
 *    divergable implementation of a decision locked in Phase 124.
 *
 * 3. Every className is a plain double-quoted string literal (or a one-line ternary of two
 *    such literals). No template literals, no clsx, no array joins. This repo has no build
 *    check that a className resolves to real CSS, so `CLASSNAME-RESOLVES` in the spec reads
 *    this file statically — and it can only see literals. Any class string returned from a
 *    helper (there is exactly one: severityClass) must carry an `impact-` or `schema-sync-`
 *    prefix so the spec's Pass B reaches it.
 *
 * `impact`'s ABSENCE is load-bearing: it means "the report was not run", which is a
 * different thing from a report with no findings. It is never defaulted to an empty report.
 */
import React, { useState } from "react";

import {
  applyTableSchema,
  checkTableSchema,
  deleteTableSyncHistoryEntry,
  listTableSyncHistory,
  type ImpactColumn,
  type ImpactRecord,
  type ImpactReport,
  type ImpactSeverity,
  type SchemaApplyResult,
  type SchemaCheckResponse,
  type SyncChangeset,
  type TableDto,
  type TableSyncHistory,
  type TableSyncHistoryEntry,
} from "../api/client";
import { SCHEMA_APPLY_TEXT_WIDTH_GAP } from "../lib/schemaSyncStrings";

// ---------------------------------------------------------------------------
// Stage machine — one useState union. No store, no context, no effect.
// ---------------------------------------------------------------------------
type Stage =
  | { k: "idle" }
  | { k: "checking" }
  | { k: "report"; check: SchemaCheckResponse }
  | { k: "applying"; check: SchemaCheckResponse }
  | { k: "result"; check: SchemaCheckResponse; result: SchemaApplyResult }
  | { k: "error"; message: string };

/**
 * The ONLY place a class string is built outside a className attribute. It therefore
 * carries the `impact-` prefix so CLASSNAME-RESOLVES Pass B can see it. The appended
 * co-class is pre-existing (global.css:150 / :153 / :156) and is the guard's stated
 * coverage boundary — see the spec's header comment.
 *
 * `--success` is deliberately absent: it aliases `--accent` (brand violet) in BOTH themes
 * and would read as an accent control rather than a severity.
 */
const severityClass = (severity: ImpactSeverity): string =>
  severity === "breaking"
    ? "impact-severity text-danger"
    : severity === "changed"
      ? "impact-severity text-warning"
      : "impact-severity text-muted";

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------
const ImpactRecordView = ({ record }: { record: ImpactRecord }) => (
  <div className="impact-record">
    <div className="impact-record-label">{record.displayLabel}</div>
    {record.advisories.map((advisory) => (
      <div className="impact-advisory" key={advisory.kind + advisory.message}>
        {advisory.message}
      </div>
    ))}
    {record.staleDrillDownType !== undefined && (
      <div className="impact-advisory">{record.staleDrillDownType.message}</div>
    )}
    {record.references.map((reference, index) => (
      <div className="impact-reference" key={reference.site + reference.path + String(index)}>
        <span className="impact-reference-path">{reference.path}</span>
        <span className="impact-reference-certainty">{reference.certainty}</span>
      </div>
    ))}
  </div>
);

const ImpactColumnView = ({ column }: { column: ImpactColumn }) => (
  <div className="impact-column">
    <div className="impact-column-head">
      <span className="impact-column-name">{column.column}</span>
      <span className="impact-column-kind">{column.changeKind}</span>
      {/* Types come straight off the payload. They are NEVER re-classified here — a
          second client-side classifier is exactly the divergence 125-02-SUMMARY gap 3
          warns about. */}
      {column.storedType !== null && (
        <span className="impact-column-types">{column.storedType}</span>
      )}
      {column.liveType !== null && (
        <span className="impact-column-types">{column.liveType}</span>
      )}
    </div>
    <div className="impact-column-summary">{column.summary}</div>
    {column.records.map((record) => (
      <ImpactRecordView record={record} key={record.recordKind + String(record.recordId) + record.displayLabel} />
    ))}
  </div>
);

const ImpactReportView = ({ report }: { report: ImpactReport }) => (
  <>
    {report.sections.map((section) => (
      <div className="schema-sync-section" key={section.severity}>
        <div className={severityClass(section.severity)} data-testid="impact-severity">
          {section.severity}
        </div>
        {section.columns.length === 0 ? (
          <div className="muted">None.</div>
        ) : (
          section.columns.map((column) => (
            <ImpactColumnView column={column} key={column.column} />
          ))
        )}
      </div>
    ))}
    {report.advisorySummary.map((advisory) => (
      <div className="config-hint" key={advisory.kind + advisory.message}>
        {advisory.message}
      </div>
    ))}
    <div className="impact-gaps">
      {report.knownGaps.map((gap) => (
        <div key={gap}>{gap}</div>
      ))}
    </div>
  </>
);

// ---------------------------------------------------------------------------
// Sync-history rendering
// ---------------------------------------------------------------------------
type ChangesetRow = { column: string; types: string };

const ChangesetGroup = ({ label, rows }: { label: string; rows: ChangesetRow[] }) => (
  <div className="schema-sync-section">
    <div className="modal-section-title">{label}</div>
    {rows.length === 0 ? (
      <div className="muted">None.</div>
    ) : (
      <table className="data-table">
        <tbody>
          {rows.map((row) => (
            <tr key={row.column}>
              <td>{row.column}</td>
              <td>{row.types}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

const ChangesetView = ({ changeset }: { changeset: SyncChangeset }) => (
  <>
    <ChangesetGroup
      label="Added"
      rows={changeset.added.map((c) => ({ column: c.column, types: c.liveType }))}
    />
    <ChangesetGroup
      label="Removed"
      rows={changeset.removed.map((c) => ({ column: c.column, types: c.storedType }))}
    />
    <ChangesetGroup
      label="Retyped"
      rows={changeset.retyped.map((c) => ({
        column: c.column,
        types: c.storedType + " to " + c.liveType,
      }))}
    />
  </>
);

/**
 * A `baseline` entry carries `changeset: null`. The counts line is derived from the
 * changeset the server stored — never recomputed from anything else.
 */
const entryCounts = (entry: TableSyncHistoryEntry): string => {
  const c = entry.changeset;
  if (c === null) return "Baseline established";
  return (
    String(c.added.length) +
    " added, " +
    String(c.removed.length) +
    " removed, " +
    String(c.retyped.length) +
    " retyped"
  );
};

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
export default function SchemaSyncModal({
  table,
  onClose,
}: {
  table: TableDto;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ k: "idle" });
  // Sibling state, NOT a Stage arm — see the file header. Stage survives a tab switch.
  const [tab, setTab] = useState<"check" | "history">("check");
  const [history, setHistory] = useState<TableSyncHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const toMessage = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

  // Click handler ONLY. Never an effect, never a timer.
  const runCheck = async () => {
    setStage({ k: "checking" });
    try {
      const check = await checkTableSchema(table.id);
      setStage({ k: "report", check });
    } catch (err) {
      setStage({ k: "error", message: toMessage(err) });
    }
  };

  // Tab-click handler and post-apply handler ONLY. Never an effect, never a timer:
  // NOPOLL-no-history-on-mount is the test that keeps that true.
  const loadHistory = async () => {
    setHistoryError(null);
    try {
      setHistory(await listTableSyncHistory(table.id));
    } catch (err) {
      setHistoryError(toMessage(err));
    }
  };

  // One click, no confirm, no undo: an entry is an audit note, not data (CONTEXT).
  // droppedCount is deliberately NOT recomputed here — the server does not decrement it
  // on a per-entry delete (index.ts:2674-2677) because it records what the CAP removed,
  // which is a different fact from how many entries remain.
  const removeEntry = async (entryId: number) => {
    try {
      await deleteTableSyncHistoryEntry(table.id, entryId);
      setHistory((prev) =>
        prev === null
          ? prev
          : { ...prev, entries: prev.entries.filter((entry) => entry.id !== entryId) },
      );
    } catch (err) {
      setHistoryError(toMessage(err));
    }
  };

  // Click handler ONLY. `table_missing` has no `live` map, so there is nothing to echo
  // back and no Apply control is rendered for it in the first place.
  const runApply = async (check: SchemaCheckResponse) => {
    if (check.outcome === "table_missing") return;
    setStage({ k: "applying", check });
    try {
      const result = await applyTableSchema(table.id, check.live);
      setStage({ k: "result", check, result });
      // An apply that actually landed wrote a history entry. Refresh so it is visible
      // without the operator reopening the modal.
      if (result.outcome === "applied") await loadHistory();
    } catch (err) {
      setStage({ k: "error", message: toMessage(err) });
    }
  };

  const applyActions = (check: SchemaCheckResponse, busy: boolean) => (
    <div className="ds-actions">
      <button className="btn-primary btn-sm" disabled={busy} onClick={() => void runApply(check)}>
        Apply
      </button>
      <button className="ghost-sm" onClick={onClose}>
        Cancel
      </button>
    </div>
  );

  const reportBody = (check: SchemaCheckResponse, busy: boolean) => {
    // Branch on `outcome` FIRST, then on `impact !== undefined`. An absent report is
    // never coalesced to an empty one: absence and emptiness mean different things.
    if (check.outcome === "table_missing") {
      return <div className="schema-sync-refusal">{check.message}</div>;
    }
    if (check.outcome === "baseline_required") {
      return (
        <>
          <div className="schema-sync-message">{check.message}</div>
          {applyActions(check, busy)}
        </>
      );
    }
    return (
      <>
        {check.hasChanges === false && (
          <div className="muted">No column changes detected.</div>
        )}
        {check.impact === undefined ? (
          <div className="muted">No impact report was returned for this check.</div>
        ) : (
          <ImpactReportView report={check.impact} />
        )}
        {applyActions(check, busy)}
      </>
    );
  };

  const historyRow = (entry: TableSyncHistoryEntry) => (
    <div className="schema-sync-history-row" key={entry.id}>
      <div className="schema-sync-history-meta">
        <span>{entry.ts}</span>
        <span>{entry.actor}</span>
        <span>{entryCounts(entry)}</span>
      </div>
      <div className="ds-actions">
        <button
          className="ghost-sm"
          onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
        >
          {expanded === entry.id ? "Hide" : "Details"}
        </button>
        <button className="ghost-sm ghost-danger" onClick={() => void removeEntry(entry.id)}>
          Delete
        </button>
      </div>
      {expanded === entry.id && (
        <div className="schema-sync-history-detail">
          {entry.changeset === null && entry.report === null ? (
            <div className="muted">
              This was a baseline entry, so there was no changeset to record.
            </div>
          ) : (
            <>
              {entry.changeset !== null && <ChangesetView changeset={entry.changeset} />}
              {/* The report as it stood at that moment, through the SAME renderer the
                  live check uses. A second report renderer would be a second, divergable
                  implementation. */}
              {entry.report !== null && <ImpactReportView report={entry.report} />}
            </>
          )}
        </div>
      )}
    </div>
  );

  const historyBody = () => {
    if (historyError !== null) {
      return <div className="schema-sync-refusal">{historyError}</div>;
    }
    if (history === null) {
      return <div className="muted">Loading sync history&hellip;</div>;
    }
    // `cap` is interpolated from the response. The server echoes it precisely so the UI
    // never hardcodes the number (db.ts:753-762); HIST-cap-notice sends cap: 5.
    const capNotice =
      "Showing the " +
      String(history.cap) +
      " most recent. " +
      String(history.droppedCount) +
      " older entries were dropped.";
    return (
      <>
        {history.droppedCount > 0 && (
          <div className="schema-sync-cap-notice" data-testid="schema-sync-cap-notice">
            {capNotice}
          </div>
        )}
        {history.entries.length === 0 ? (
          <div className="muted">No syncs recorded for this table yet.</div>
        ) : (
          // In the order given. The server returns newest first (id DESC); re-sorting
          // here would be a second ordering implementation.
          history.entries.map((entry) => historyRow(entry))
        )}
      </>
    );
  };

  const resultBody = (result: SchemaApplyResult) => (
    <>
      {result.outcome === "stale" || result.outcome === "table_missing" ? (
        <div className="schema-sync-refusal">{result.message}</div>
      ) : (
        <div className="schema-sync-message">{result.message}</div>
      )}
      {result.outcome === "stale" && (
        <div className="ds-actions">
          <button className="btn-primary btn-sm" onClick={() => void runCheck()}>
            Re-check
          </button>
        </div>
      )}
      {/* Only on `applied`: the caveat describes a column being STORED, which a
          `no_changes` apply never did. See plan 02 <planner_decisions> A. */}
      {result.outcome === "applied" && (
        <div className="schema-sync-caveat">{SCHEMA_APPLY_TEXT_WIDTH_GAP}</div>
      )}
    </>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content schema-sync-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Schema sync — {table.name}</div>
          <button className="ghost-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body schema-sync-body">
          <div className="schema-sync-tabs">
            <button
              className={tab === "check" ? "ghost-sm schema-sync-tab-active" : "ghost-sm"}
              onClick={() => setTab("check")}
            >
              Schema check
            </button>
            <button
              className={tab === "history" ? "ghost-sm schema-sync-tab-active" : "ghost-sm"}
              onClick={() => {
                setTab("history");
                void loadHistory();
              }}
            >
              Sync history
            </button>
          </div>

          {tab === "history" && historyBody()}

          {tab === "check" && stage.k === "idle" && (
            <>
              <div className="muted">
                A check compares this table&rsquo;s stored columns against the live table and
                reports everything a sync would change. Nothing is written until you apply.
              </div>
              <div className="ds-actions">
                <button className="btn-primary btn-sm" onClick={() => void runCheck()}>
                  Check for changes
                </button>
              </div>
            </>
          )}

          {tab === "check" && stage.k === "checking" && (
            <>
              <div className="muted">Checking&hellip;</div>
              <div className="ds-actions">
                <button className="btn-primary btn-sm" disabled>
                  Check for changes
                </button>
              </div>
            </>
          )}

          {tab === "check" && stage.k === "report" && reportBody(stage.check, false)}

          {tab === "check" && stage.k === "applying" && (
            <>
              <div className="muted">Applying&hellip;</div>
              {reportBody(stage.check, true)}
            </>
          )}

          {tab === "check" && stage.k === "result" && resultBody(stage.result)}

          {tab === "check" && stage.k === "error" && (
            <div className="schema-sync-refusal">{stage.message}</div>
          )}
        </div>
      </div>
    </div>
  );
}
