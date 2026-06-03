/**
 * Phase 34 (DV-V16-08, DV-V16-09, DV-V16-10, DV-V16-11): Dashboard-scoped Dynamic Views management modal.
 *
 * Two-pane modal mirroring LayersModal (Phase 12) structurally:
 *   - Left pane: list of existing dynamic views + per-row status badge + inline delete confirm + + New button.
 *   - Right pane: form (name, source-table picker, CodeMirror SQL editor with Insert {view} button,
 *     max_records numeric input, Preview button + 5-state output panel). Save button lands in Plan 34-04.
 *
 * Plan 34-03 scope (this file extends Plan 34-02):
 *   - Form state machine: name / source_table_id / template_sql / max_records (draft string + committed int) /
 *     formColumnsJson / originalTemplateSql / previewRanSinceLastSave / isDirty / 4 inline error states.
 *   - CodeMirror editor wired via @uiw/react-codemirror + @codemirror/lang-sql.
 *   - Insert {view} button — cursor-position via view.dispatch({ changes: { from: pos, insert: '{view}' } }).
 *     editorViewRef captured via onCreateEditor (first cursor-position implementation in this codebase).
 *   - max_records clamp-on-blur (mirrors MapConfigPanel.clampRadius — no upper bound, min 1, integer).
 *   - PreviewState discriminated union with `source: 'validation' | 'server'` field. Validation errors
 *     reset on form-field edit; server errors persist until next Preview click.
 *   - previewRanSinceLastSave flag — initialized false, flips TRUE only on Preview success. Plan 34-04
 *     consumes for columns_json carry decision.
 *   - previewAbortRef — operation-scoped controller. Mount-time abortRef from Plan 34-02 is preserved
 *     verbatim for the listDynamicViews call.
 *
 * Out of scope (Plan 34-04):
 *   - Save handler + button (handleSave / saveAbortRef)
 *   - DashboardsPage 4th action-bar button + modal mount
 *   - columns_json carry rules in Save body (reads previewRanSinceLastSave from this plan)
 *
 * AbortController scope:
 *   - abortRef (mount-time, Plan 34-02): scopes listDynamicViews.
 *   - previewAbortRef (operation-scoped, Plan 34-03): scopes each Preview call; aborted on next click + on unmount.
 *   - Plan 34-04 will ADD saveAbortRef + deleteAbortRef.
 */

import { useState, useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTrash,
  faCheck,
  faSpinner,
  faTriangleExclamation,
  faCircleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import CodeMirror, { oneDark } from "@uiw/react-codemirror";
import { useThemeStore } from "../store/theme";
import { sql } from "@codemirror/lang-sql";
import type { EditorView } from "@codemirror/view";
import {
  listDynamicViews,
  deleteDynamicView,
  previewDynamicView,
  createDynamicView,                    // NEW Plan 34-04 — Save handler (create branch)
  updateDynamicView,                    // NEW Plan 34-04 — Save handler (update branch)
  materializeDynamicView,               // NEW Plan 34-04 — Save handler (materialize step)
  type DynamicViewRow,
  type DynamicViewColumn,
  type PreviewDynamicViewResponse,
  type TableDto,
  type UpdateDynamicViewArgs,           // NEW Plan 34-04 (MAJOR #3) — Save UPDATE body type
  type CreateDynamicViewArgs,           // Post-VERIFY fix — CREATE body type now includes optional columns_json
} from "../api/client";
import {
  useDynamicViewStore,
  type DynamicViewStatus,
  type DynamicViewReason,
} from "../store/dynamicViewStore";
import { useToastStore } from "../store/toast";
import { buildDynamicViewName } from "../lib/dynamicViewName";  // NEW Plan 34-04 — deterministic viewName
import { useAuthStore } from "../store/auth";                    // NEW Plan 34-04 — userId for buildDynamicViewName

export type DynamicViewsModalProps = {
  dashboardId: number;
  associatedTables: TableDto[];
  onClose: () => void;
};

// ---- Preview state machine (LOCKED per MAJOR #4 — discriminated union with error-source tag) ----
type PreviewErrorSource = "validation" | "server";
type PreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; rows: unknown[][]; columns: DynamicViewColumn[] }
  | { kind: "error"; source: PreviewErrorSource; message: string };

export default function DynamicViewsModal({
  dashboardId,
  associatedTables: _associatedTables,
  onClose,
}: DynamicViewsModalProps): JSX.Element {
  // ---- State (Plan 34-02 — left list + selection) ----
  const [views, setViews] = useState<DynamicViewRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isDraft, setIsDraft] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  // Bumps on every + New click so the lifecycle effect re-fires even when isDraft was already true.
  const [draftSession, setDraftSession] = useState(0);

  // ---- Form state (Plan 34-03 — DV-V16-09) ----
  const [formName, setFormName] = useState("");
  const [formSourceTableId, setFormSourceTableId] = useState<number | null>(null);
  const [formTemplateSql, setFormTemplateSql] = useState("");
  const [formMaxRecordsDraft, setFormMaxRecordsDraft] = useState("10000");
  const [formMaxRecords, setFormMaxRecords] = useState(10000);
  const [formColumnsJson, setFormColumnsJson] = useState<string | null>(null);

  // Post-VERIFY type fix: server `mapDashboardDynamicView` ships PARSED arrays on the
  // wire while local `formColumnsJson` state is a stringified form (it's the canonical
  // type expected by Save handlers + spec assertions). Normalize at the row-load boundary
  // so `setFormColumnsJson` always receives a string-or-null.
  const normalizeColumnsJson = (
    value: { name: string; type: string }[] | string | null,
  ): string | null => {
    if (value === null) return null;
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  };
  const [originalTemplateSql, setOriginalTemplateSql] = useState<string | null>(null);

  // LOCKED per BLOCKER #1: tracks whether the operator has run Preview since the last Save (or row load).
  // Initialized to false; flips TRUE only on Preview success. Plan 34-04 reads this for columns_json carry.
  const [previewRanSinceLastSave, setPreviewRanSinceLastSave] = useState<boolean>(false);

  const [isDirty, setIsDirty] = useState(false);

  // ---- Inline form errors ----
  const [nameError, setNameError] = useState<string | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [maxRecordsError, setMaxRecordsError] = useState<string | null>(null);

  // ---- CodeMirror EditorView ref (Plan 34-03 — captured via onCreateEditor for cursor-insert) ----
  const editorViewRef = useRef<EditorView | null>(null);

  // ---- Preview state machine (Plan 34-03 — DV-V16-10) ----
  const [previewState, setPreviewState] = useState<PreviewState>({ kind: "idle" });
  const [previewLoading, setPreviewLoading] = useState(false);

  // ---- Save state (Plan 34-04 — DV-V16-09 closure) ----
  const [saving, setSaving] = useState(false);

  // ---- AbortController refs ----
  // AbortController inventory (4 total, per CONTEXT.md "AbortController scope"):
  //   1. abortRef          — Plan 34-02; mount-time, scoped to listDynamicViews call.
  //   2. previewAbortRef   — Plan 34-03; operation-scoped, aborted on next Preview click + unmount.
  //   3. saveAbortRef      — Plan 34-04 (this plan); operation-scoped, wraps CRUD + materialize.
  //   4. deleteAbortRef    — Plan 34-04 (this plan); operation-scoped, wraps deleteDynamicView call.
  const abortRef = useRef<AbortController | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const saveAbortRef = useRef<AbortController | null>(null);
  const deleteAbortRef = useRef<AbortController | null>(null);

  // ---- Cleanup on unmount (aborts all 3 operation-scoped refs) ----
  useEffect(
    () => () => {
      previewAbortRef.current?.abort();
      saveAbortRef.current?.abort();
      deleteAbortRef.current?.abort();
    },
    [],
  );

  // ---- Mount-time list (Plan 34-02 — preserved) ----
  useEffect(() => {
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setViews(null);
    setLoadError(null);
    listDynamicViews(dashboardId, signal)
      .then(({ dynamic_views }) => {
        if (signal.aborted) return;
        setViews(dynamic_views);
      })
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        if (signal.aborted) return;
        setLoadError((err as Error)?.message ?? "Failed to load dynamic views");
      });
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [dashboardId]);

  // ---- Form lifecycle: populate when row selected or draft mode triggered ----
  useEffect(() => {
    if (isDraft) {
      setFormName("");
      setFormSourceTableId(_associatedTables[0]?.id ?? null);
      setFormTemplateSql("");
      setFormMaxRecordsDraft("10000");
      setFormMaxRecords(10000);
      setFormColumnsJson(null);
      setOriginalTemplateSql(null);
      setPreviewRanSinceLastSave(false); // LOCKED reset
      setPreviewState({ kind: "idle" });
      setNameError(null);
      setTableError(null);
      setSqlError(null);
      setMaxRecordsError(null);
      setIsDirty(false);
      return;
    }
    if (selectedId !== null) {
      const row = views?.find((v) => v.id === selectedId);
      if (!row) return;
      setFormName(row.name);
      setFormSourceTableId(row.source_table_id);
      setFormTemplateSql(row.template_sql);
      // 0 = unlimited; keep a positive draft so unchecking "Unlimited" restores a sane value.
      setFormMaxRecordsDraft(row.max_records > 0 ? String(row.max_records) : "10000");
      setFormMaxRecords(row.max_records);
      setFormColumnsJson(normalizeColumnsJson(row.columns_json));
      setOriginalTemplateSql(row.template_sql);
      setPreviewRanSinceLastSave(false); // LOCKED reset (NEVER carries from a prior session)
      setPreviewState({ kind: "idle" });
      setNameError(null);
      setTableError(null);
      setSqlError(null);
      setMaxRecordsError(null);
      setIsDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraft, selectedId, views, draftSession]);

  // ---- Close paths (ESC + click-outside + Close button — all route through handleCloseRequest) ----
  const handleCloseRequest = () => {
    if (isDirty) {
      const ok = window.confirm("Discard unsaved changes?");
      if (!ok) return;
    }
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCloseRequest();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, onClose]);

  // ---- Delete flow (Plan 34-02 — migrated to deleteAbortRef in Plan 34-04 per MAJOR #2) ----
  const handleDelete = async (id: number) => {
    deleteAbortRef.current?.abort();
    const ctrl = new AbortController();
    deleteAbortRef.current = ctrl;
    try {
      await deleteDynamicView(id, ctrl.signal);
      if (ctrl.signal.aborted) return;
      useDynamicViewStore.getState().clearView(id);
      setViews((prev) => (prev ?? []).filter((v) => v.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setIsDraft(false);
      }
      useToastStore.getState().showToast("View deleted", "info");
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      const msg = (err as Error)?.message ?? "unknown";
      useToastStore.getState().showToast(`Failed to delete view: ${msg}`, "error");
    } finally {
      setConfirmDeleteId(null);
    }
  };

  const handleSelect = (id: number) => {
    setSelectedId(id);
    setIsDraft(false);
  };

  const handleNew = () => {
    setSelectedId(null);
    setIsDraft(true);
    setDraftSession((n) => n + 1); // ensure lifecycle effect re-runs on subsequent + New clicks
  };

  // ---- Form field handlers ----
  // LOCKED per MAJOR #4: validation-source errors reset on field edits; server-source errors persist.
  const resetValidationPreviewError = () => {
    setPreviewState((prev) =>
      prev.kind === "error" && prev.source === "validation" ? { kind: "idle" } : prev,
    );
  };

  const handleSetFormName = (v: string) => {
    setFormName(v);
    setIsDirty(true);
    setNameError(null);
  };
  const handleSetFormSourceTableId = (v: number | null) => {
    setFormSourceTableId(v);
    setIsDirty(true);
    setTableError(null);
    resetValidationPreviewError();
  };
  const handleSetFormTemplateSql = (v: string) => {
    setFormTemplateSql(v);
    setIsDirty(true);
    setSqlError(null);
    resetValidationPreviewError();
  };

  // ---- max_records clamp-on-blur (mirrors MapConfigPanel.clampRadius — no upper bound) ----
  const clampMaxRecords = (raw: string): { value: number; clamped: boolean; msg?: string } => {
    const n = Number(raw);
    if (!Number.isFinite(n) || raw.trim() === "") {
      return { value: 1, clamped: true, msg: "Must be at least 1" };
    }
    const rounded = Math.round(n);
    if (rounded < 1) return { value: 1, clamped: true, msg: "Must be at least 1" };
    return { value: rounded, clamped: rounded !== n };
  };

  const handleMaxRecordsBlur = () => {
    const { value, clamped, msg } = clampMaxRecords(formMaxRecordsDraft);
    setFormMaxRecordsDraft(String(value));
    setFormMaxRecords(value);
    if (clamped && msg) {
      setMaxRecordsError(msg);
      setTimeout(() => setMaxRecordsError(null), 3000);
    } else {
      setMaxRecordsError(null);
    }
    setIsDirty(true);
  };

  // "Unlimited" toggle: 0 = unlimited (no row cap). Unchecking restores a positive value
  // from the draft, falling back to the default cap.
  const handleToggleUnlimited = (checked: boolean) => {
    if (checked) {
      setFormMaxRecords(0);
    } else {
      const parsed = Number(formMaxRecordsDraft);
      const value = Number.isFinite(parsed) && parsed >= 1 ? Math.round(parsed) : 10000;
      setFormMaxRecords(value);
      setFormMaxRecordsDraft(String(value));
    }
    setMaxRecordsError(null);
    setIsDirty(true);
  };

  // ---- Insert {view} handler (cursor-position via CM6 dispatch) ----
  const handleInsertViewToken = () => {
    const view = editorViewRef.current;
    if (!view) return; // editor not mounted yet — safe no-op
    const pos = view.state.selection.main.head;
    view.dispatch({ changes: { from: pos, insert: "{view}" } });
    view.focus();
  };

  // ---- Preview handler ----
  const handlePreviewClick = async () => {
    // Validation (sets source: "validation" so subsequent field edits reset it).
    if (!formTemplateSql.trim() || formSourceTableId === null) {
      setPreviewState({
        kind: "error",
        source: "validation",
        message: "Select a source table and write SQL first.",
      });
      return;
    }
    previewAbortRef.current?.abort();
    const ctrl = new AbortController();
    previewAbortRef.current = ctrl;
    setPreviewLoading(true);
    setPreviewState({ kind: "loading" });
    try {
      const result: PreviewDynamicViewResponse = await previewDynamicView(
        {
          template_sql: formTemplateSql,
          source_table_id: formSourceTableId,
          dashboard_id: dashboardId,
          sample_limit: 100,
        },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      setPreviewState({ kind: "success", rows: result.rows, columns: result.columns });
      setFormColumnsJson(JSON.stringify(result.columns));
      setPreviewRanSinceLastSave(true); // LOCKED — only flip on success
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return; // silent — modal closed or re-clicked
      setPreviewState({
        kind: "error",
        source: "server",
        message: (err as Error).message ?? "Preview failed",
      });
      // Do NOT touch formColumnsJson or previewRanSinceLastSave on error.
    } finally {
      setPreviewLoading(false);
    }
  };

  // ---- Save handler (Plan 34-04 — DV-V16-09 closure) ----
  // columns_json carry-rule (LOCKED per BLOCKER #1):
  //   CREATE: never sends columns_json (server defaults null).
  //   UPDATE & template unchanged: omit columns_json (server preserves).
  //   UPDATE & template changed AND previewRanSinceLastSave AND formColumnsJson !== null: send columns_json.
  //   UPDATE & template changed AND (NOT previewRanSinceLastSave OR formColumnsJson null): omit (server auto-clears).
  // On Save success: reset previewRanSinceLastSave=false, isDirty=false, originalTemplateSql=saved value.
  const handleSaveClick = async () => {
    // Local validation — no network call on failure.
    let hasErr = false;
    if (!formName.trim()) {
      setNameError("Name is required");
      hasErr = true;
    }
    if (formSourceTableId === null) {
      setTableError("Source table is required");
      hasErr = true;
    }
    if (!formTemplateSql.trim()) {
      setSqlError("Template SQL is required");
      hasErr = true;
    }
    // 0 = unlimited (valid); negatives are invalid.
    if (formMaxRecords < 0) {
      setMaxRecordsError("Max records must be 0 (unlimited) or at least 1");
      hasErr = true;
    }
    if (hasErr) return;

    saveAbortRef.current?.abort();
    const ctrl = new AbortController();
    saveAbortRef.current = ctrl;
    setSaving(true);
    setSqlError(null); // clear any prior server-error inline

    // Post-VERIFY fix: auto-Preview on Save when fresh column metadata is needed.
    // Triggers:
    //   - CREATE (isDraft) AND no manual Preview ran → auto-Preview to populate columns_json
    //   - UPDATE template_changed AND no manual Preview ran → auto-Preview (the stale row-load
    //     formColumnsJson no longer matches the edited template; server would otherwise
    //     auto-clear it on a template-only PUT)
    //   - UPDATE template_unchanged → SKIP auto-Preview (server preserves existing columns_json)
    //
    // If the operator already clicked Preview successfully (previewRanSinceLastSave=true),
    // formColumnsJson is fresh — skip the auto-Preview round-trip. If Preview fails
    // (Kinetica SQL error), surface the error inline and abort Save.
    const templateChanged = !isDraft && formTemplateSql !== originalTemplateSql;
    const needFreshPreview =
      !previewRanSinceLastSave && (isDraft || templateChanged);
    let columnsJsonForSave: string | null = formColumnsJson;
    if (needFreshPreview) {
      try {
        const previewResult: PreviewDynamicViewResponse = await previewDynamicView(
          {
            template_sql: formTemplateSql,
            source_table_id: formSourceTableId!,
            dashboard_id: dashboardId,
            sample_limit: 1, // we only need the column metadata, not rows
          },
          ctrl.signal,
        );
        if (ctrl.signal.aborted) return;
        columnsJsonForSave = JSON.stringify(previewResult.columns);
        // Update local state so the Preview panel (if open) reflects the auto-Preview result.
        setFormColumnsJson(columnsJsonForSave);
        setPreviewRanSinceLastSave(true);
        setPreviewState({
          kind: "success",
          rows: previewResult.rows,
          columns: previewResult.columns,
        });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setSaving(false);
        // Surface the Kinetica error inline below the SQL editor — operator can fix the
        // template and retry Save (which will auto-Preview again).
        setSqlError(
          `Preview failed (cannot populate column metadata): ${(err as Error).message ?? "unknown error"}`,
        );
        return;
      }
    }

    try {
      let row: DynamicViewRow;
      if (isDraft) {
        // CREATE — send columns_json when Preview ran successfully in this draft session.
        // Post-VERIFY fix: the BLOCKER #1 lock was "never send on CREATE" to prevent stale-data
        // bugs, but the Preview-then-Save flow on a NEW view is the canonical way to populate
        // columns_json. Without sending it on CREATE, dv.columns_json stays null forever and
        // Phase 35 column pickers (ChartConfigPanel + LayersModal) have nothing to show.
        // Gate: previewRanSinceLastSave === true AND formColumnsJson !== null. If operator
        // Saved without Preview, columns_json is omitted (server defaults null — same legacy
        // behavior).
        const createBody: CreateDynamicViewArgs = {
          source_table_id: formSourceTableId!,
          name: formName.trim(),
          template_sql: formTemplateSql,
          max_records: formMaxRecords,
        };
        // columnsJsonForSave is guaranteed non-null here either because:
        // (a) operator clicked Preview manually and formColumnsJson was already populated, OR
        // (b) the auto-Preview branch above just populated it.
        if (columnsJsonForSave !== null) {
          try {
            const parsed = JSON.parse(columnsJsonForSave) as unknown;
            if (
              Array.isArray(parsed) &&
              parsed.every(
                (c) =>
                  c !== null &&
                  typeof c === "object" &&
                  typeof (c as { name?: unknown }).name === "string" &&
                  typeof (c as { type?: unknown }).type === "string",
              )
            ) {
              createBody.columns_json = parsed as { name: string; type: string }[];
            }
          } catch {
            /* malformed local state — fall through; server will see omitted field */
          }
        }
        const result = await createDynamicView(dashboardId, createBody, ctrl.signal);
        row = result.dynamic_view;
      } else {
        // UPDATE — columns_json carry-rule (LOCKED per BLOCKER #1 + post-VERIFY auto-Preview):
        //   templateChanged && columnsJsonForSave !== null  →  send
        //   else                                            →  omit (server preserves or auto-clears)
        //
        // The original BLOCKER #1 gate also required previewRanSinceLastSave to prevent stale
        // formColumnsJson from leaking on edit-without-Preview. The post-VERIFY auto-Preview
        // above already guarantees columnsJsonForSave is fresh (auto-Preview ran with the
        // current formTemplateSql), so the previewRanSinceLastSave check is redundant here.
        // templateChanged was already computed before the auto-Preview block.
        const body: UpdateDynamicViewArgs = {
          source_table_id: formSourceTableId!,
          name: formName.trim(),
          template_sql: formTemplateSql,
          max_records: formMaxRecords,
        };
        if (templateChanged && columnsJsonForSave !== null) {
          // body.columns_json expects the parsed { name, type }[] array, not the stringified form.
          try {
            const parsed = JSON.parse(columnsJsonForSave) as unknown;
            if (
              Array.isArray(parsed) &&
              parsed.every(
                (c) =>
                  c !== null &&
                  typeof c === "object" &&
                  typeof (c as { name?: unknown }).name === "string" &&
                  typeof (c as { type?: unknown }).type === "string",
              )
            ) {
              body.columns_json = parsed as { name: string; type: string }[];
            }
          } catch {
            /* malformed local state — omit columns_json (server auto-clears on template change) */
          }
        }
        const result = await updateDynamicView(selectedId!, body, ctrl.signal);
        row = result.dynamic_view;
      }

      if (ctrl.signal.aborted) return;

      // CRUD success — refresh local list + reset form to canonical server response.
      setViews((prev) => {
        if (!prev) return prev;
        const idx = prev.findIndex((v) => v.id === row.id);
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = row;
          return next;
        }
        return [...prev, row];
      });
      setSelectedId(row.id);
      setIsDraft(false);
      setOriginalTemplateSql(row.template_sql);
      setFormColumnsJson(normalizeColumnsJson(row.columns_json));
      setIsDirty(false);
      setPreviewRanSinceLastSave(false); // LOCKED — new Save session; operator must re-Preview to send columns_json again.

      // Materialize sequence.
      const username = useAuthStore.getState().user?.username;
      if (!username) {
        useToastStore
          .getState()
          .showToast("Session expired — please log in again", "error");
        return;
      }
      const viewName = buildDynamicViewName({
        userId: username,
        dashboardId,
        dynamicViewId: row.id,
      });
      useDynamicViewStore.getState().markPending(row.id, viewName);

      try {
        const matResult = await materializeDynamicView(row.id, ctrl.signal);
        if (ctrl.signal.aborted) return;
        if (matResult.status === "materialized") {
          useDynamicViewStore.getState().setView(row.id, {
            viewName: matResult.view_name,
            status: "materialized",
            expiresAt: matResult.expires_at,
          });
          useToastStore
            .getState()
            .showToast(`Dynamic view "${row.name}" materialized`, "info");
        } else if (matResult.status === "over_threshold") {
          useDynamicViewStore.getState().setView(row.id, {
            viewName,
            status: "over_threshold",
            reason: matResult.reason,
          });
          if (matResult.reason === "no_filter") {
            useToastStore
              .getState()
              .showToast(
                `Saved "${row.name}" — no filter active; view will materialize when a filter is applied.`,
                "info",
              );
          } else {
            // exceeds_max_records — LOCKED kind is "info" (the toast type union excludes the no-such-kind alternative).
            useToastStore
              .getState()
              .showToast(
                `Saved "${row.name}" — ${matResult.row_count} rows exceeds max_records ${row.max_records}; raise the threshold or narrow filters.`,
                "info",
              );
          }
        }
      } catch (matErr) {
        if ((matErr as Error)?.name === "AbortError") return; // silent
        const matMsg = (matErr as Error).message ?? "unknown";
        useDynamicViewStore.getState().setError(row.id, matMsg);
        useToastStore.getState().showToast(`Materialize failed: ${matMsg}`, "error");
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return; // silent on modal close
      const msg = (err as Error).message ?? "Save failed";
      // Inline error below editor with verbatim server message (Plan 34-01's throwForStatus preserves it).
      setSqlError(msg);
    } finally {
      setSaving(false);
    }
  };

  // ---- Right-pane content selector ----
  const selectedView =
    selectedId !== null ? views?.find((v) => v.id === selectedId) ?? null : null;

  const showForm = isDraft || selectedView !== null;
  const noTables = _associatedTables.length === 0;

  // ---- Render ----
  return (
    <div className="modal-overlay" onClick={handleCloseRequest}>
      <div
        className="modal-content modal-layers"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">Dynamic Views</div>
          <button className="ghost-sm" onClick={handleCloseRequest}>
            Close
          </button>
        </div>
        <div className="dynamic-views-modal-body">
          <div className="dynamic-views-modal-left">
            {views === null && !loadError ? (
              <div className="dynamic-views-modal-empty">Loading…</div>
            ) : loadError ? (
              <div className="dynamic-views-modal-empty error">{loadError}</div>
            ) : views && views.length === 0 ? (
              <div className="dynamic-views-modal-empty">No dynamic views yet.</div>
            ) : (
              <div className="dynamic-views-modal-list">
                {(views ?? []).map((v) => (
                  <ViewListRow
                    key={v.id}
                    row={v}
                    isActive={v.id === selectedId}
                    isConfirming={confirmDeleteId === v.id}
                    onSelect={handleSelect}
                    onDeleteClick={() => setConfirmDeleteId(v.id)}
                    onConfirmDelete={() => handleDelete(v.id)}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                  />
                ))}
              </div>
            )}
            <div className="dynamic-views-modal-add">
              <button className="btn-primary" type="button" onClick={handleNew}>
                + New dynamic view
              </button>
            </div>
          </div>
          <div className="dynamic-views-modal-right">
            {showForm && noTables ? (
              <div className="dynamic-views-modal-empty error">
                This dashboard has no associated tables. Click Tables to add one first.
              </div>
            ) : showForm ? (
              <DynamicViewForm
                formName={formName}
                onSetFormName={handleSetFormName}
                formSourceTableId={formSourceTableId}
                onSetFormSourceTableId={handleSetFormSourceTableId}
                associatedTables={_associatedTables}
                formTemplateSql={formTemplateSql}
                onSetFormTemplateSql={handleSetFormTemplateSql}
                formMaxRecordsDraft={formMaxRecordsDraft}
                onSetFormMaxRecordsDraft={setFormMaxRecordsDraft}
                onMaxRecordsBlur={handleMaxRecordsBlur}
                unlimited={formMaxRecords === 0}
                onToggleUnlimited={handleToggleUnlimited}
                onInsertViewToken={handleInsertViewToken}
                onCreateEditor={(view) => {
                  editorViewRef.current = view;
                }}
                nameError={nameError}
                tableError={tableError}
                sqlError={sqlError}
                maxRecordsError={maxRecordsError}
                previewState={previewState}
                previewLoading={previewLoading}
                onPreviewClick={handlePreviewClick}
                saving={saving}
                onSaveClick={handleSaveClick}
              />
            ) : (
              <div className="dynamic-views-modal-empty">
                Select a view or click + New to get started.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Sub-component: DynamicViewForm — form fields + Preview panel
// ===========================================================================

type DynamicViewFormProps = {
  formName: string;
  onSetFormName: (v: string) => void;
  formSourceTableId: number | null;
  onSetFormSourceTableId: (v: number | null) => void;
  associatedTables: TableDto[];
  formTemplateSql: string;
  onSetFormTemplateSql: (v: string) => void;
  formMaxRecordsDraft: string;
  onSetFormMaxRecordsDraft: (v: string) => void;
  onMaxRecordsBlur: () => void;
  unlimited: boolean;
  onToggleUnlimited: (checked: boolean) => void;
  onInsertViewToken: () => void;
  onCreateEditor: (view: EditorView) => void;
  nameError: string | null;
  tableError: string | null;
  sqlError: string | null;
  maxRecordsError: string | null;
  previewState: PreviewState;
  previewLoading: boolean;
  onPreviewClick: () => void;
  saving: boolean;                    // NEW Plan 34-04
  onSaveClick: () => void;            // NEW Plan 34-04
};

function DynamicViewForm({
  formName,
  onSetFormName,
  formSourceTableId,
  onSetFormSourceTableId,
  associatedTables,
  formTemplateSql,
  onSetFormTemplateSql,
  formMaxRecordsDraft,
  onSetFormMaxRecordsDraft,
  onMaxRecordsBlur,
  unlimited,
  onToggleUnlimited,
  onInsertViewToken,
  onCreateEditor,
  nameError,
  tableError,
  sqlError,
  maxRecordsError,
  previewState,
  previewLoading,
  onPreviewClick,
  saving,
  onSaveClick,
}: DynamicViewFormProps): JSX.Element {
  const placeholder =
    "-- Use {view} where you'd reference the source filter view\n-- e.g., SELECT vendor, AVG(fare) AS avg_fare FROM {view} GROUP BY vendor";
  // CodeMirror theme follows the app theme (One Dark in dark mode, built-in light otherwise).
  const editorTheme = useThemeStore((s) => s.theme) === "dark" ? oneDark : "light";

  return (
    <div className="dynamic-views-modal-form">
      {/* Name input */}
      <div className="dynamic-views-modal-field">
        <label className="ds-field-label" htmlFor="dv-form-name">
          Name
        </label>
        <input
          id="dv-form-name"
          type="text"
          aria-label="Name"
          placeholder="Name your dynamic view"
          value={formName}
          onChange={(e) => onSetFormName(e.target.value)}
        />
        {nameError && <div className="dynamic-views-modal-field-error">{nameError}</div>}
      </div>

      {/* Source-table picker */}
      <div className="dynamic-views-modal-field">
        <label className="ds-field-label" htmlFor="dv-form-table">
          Source table
        </label>
        <select
          id="dv-form-table"
          aria-label="Source table"
          value={formSourceTableId === null ? "" : String(formSourceTableId)}
          onChange={(e) => {
            const v = e.target.value;
            onSetFormSourceTableId(v === "" ? null : parseInt(v, 10));
          }}
        >
          {associatedTables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.schema ? `${t.schema}.${t.name}` : t.name}
            </option>
          ))}
        </select>
        {tableError && <div className="dynamic-views-modal-field-error">{tableError}</div>}
      </div>

      {/* CodeMirror editor + Insert {view} button + hint */}
      <div className="dynamic-views-modal-editor-section">
        <div className="dynamic-views-modal-editor-header">
          <label className="ds-field-label">Template SQL</label>
          <button type="button" className="ghost-sm" onClick={onInsertViewToken}>
            Insert {"{view}"}
          </button>
        </div>
        <CodeMirror
          value={formTemplateSql}
          onChange={onSetFormTemplateSql}
          extensions={[sql()]}
          theme={editorTheme}
          minHeight="200px"
          maxHeight="400px"
          placeholder={placeholder}
          onCreateEditor={(view) => onCreateEditor(view)}
        />
        <div className="dynamic-views-modal-editor-hint">
          Use {"{view}"} where you'd reference the source filter view.
        </div>
        {sqlError && <div className="dynamic-views-modal-field-error">{sqlError}</div>}
      </div>

      {/* max_records numeric input + Unlimited toggle (0 = unlimited / no row cap) */}
      <div className="dynamic-views-modal-field">
        <label className="ds-field-label" htmlFor="dv-form-max-records">
          Max records
        </label>
        <label className="config-toggle" style={{ marginBottom: 6 }}>
          <input
            type="checkbox"
            aria-label="Unlimited max records"
            checked={unlimited}
            onChange={(e) => onToggleUnlimited(e.target.checked)}
          />
          <span>Unlimited (no row cap)</span>
        </label>
        <input
          id="dv-form-max-records"
          type="number"
          min={1}
          step={1}
          aria-label="Max records"
          value={unlimited ? "" : formMaxRecordsDraft}
          placeholder={unlimited ? "Unlimited — no row cap" : undefined}
          disabled={unlimited}
          aria-disabled={unlimited}
          onChange={(e) => onSetFormMaxRecordsDraft(e.target.value)}
          onBlur={onMaxRecordsBlur}
        />
        {maxRecordsError && (
          <div className="dynamic-views-modal-field-error">{maxRecordsError}</div>
        )}
      </div>

      {/* Preview button — stays enabled during loading so re-click aborts the in-flight call. */}
      <div className="dynamic-views-modal-form-actions">
        <button
          type="button"
          data-testid="preview-button"
          aria-label="Preview"
          className="btn-primary btn-sm"
          onClick={onPreviewClick}
        >
          {previewLoading ? "Running…" : "Preview"}
        </button>
      </div>

      {/* Preview output panel (5 states) */}
      <div className="dynamic-views-modal-preview">
        {previewState.kind === "idle" && (
          <div className="dynamic-views-modal-empty">Click Preview to see sample data.</div>
        )}
        {previewState.kind === "loading" && (
          <div className="dynamic-views-modal-empty">Running preview…</div>
        )}
        {previewState.kind === "error" && (
          <div
            className="dynamic-views-modal-preview-error"
            data-error-source={previewState.source}
          >
            {previewState.message}
          </div>
        )}
        {previewState.kind === "success" && (
          <>
            <div className="dynamic-views-modal-preview-chips">
              {[...previewState.columns]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <span key={c.name} className="dynamic-views-modal-preview-chip">
                    {c.name} {c.type.toUpperCase()}
                  </span>
                ))}
            </div>
            {previewState.rows.length === 0 ? (
              <div className="dynamic-views-modal-empty">
                Query returned 0 rows. Check filters and template.
              </div>
            ) : (
              <div className="dynamic-views-modal-preview-table-wrap">
                <table className="dynamic-views-modal-preview-table">
                  <thead>
                    <tr>
                      {previewState.columns.map((c) => (
                        <th key={c.name}>{c.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewState.rows.map((r, i) => (
                      <tr key={i}>
                        {r.map((cell, j) => (
                          <td key={j}>{String(cell ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="dynamic-views-modal-preview-footer">
              {previewState.rows.length} rows previewed (sample_limit=100)
            </div>
          </>
        )}
      </div>

      {/* Save button (Plan 34-04 — DV-V16-09 closure). Primary action; lives below Preview panel. */}
      <div className="dynamic-views-modal-form-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={onSaveClick}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ===========================================================================
// Sub-component: ViewListRow — per-row scoped store consumer (PITFALL S-02 / C-02)
// ===========================================================================

type ViewListRowProps = {
  row: DynamicViewRow;
  isActive: boolean;
  isConfirming: boolean;
  onSelect: (id: number) => void;
  onDeleteClick: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
};

function ViewListRow({
  row,
  isActive,
  isConfirming,
  onSelect,
  onDeleteClick,
  onConfirmDelete,
  onCancelDelete,
}: ViewListRowProps): JSX.Element {
  const status = useDynamicViewStore((s) => s.views[row.id]?.status);
  const reason = useDynamicViewStore((s) => s.views[row.id]?.reason);
  const error = useDynamicViewStore((s) => s.views[row.id]?.error);

  return (
    <div
      className={`view-row${isActive ? " active" : ""}`}
      onClick={() => onSelect(row.id)}
      role="button"
      tabIndex={0}
    >
      <span className="view-row-name">{row.name}</span>
      <ViewStatusBadge status={status} reason={reason} error={error} />
      <div className="view-row-actions">
        {isConfirming ? (
          <>
            <button
              type="button"
              className="view-row-btn danger"
              onClick={(e) => {
                e.stopPropagation();
                onConfirmDelete();
              }}
            >
              Delete view
            </button>
            <button
              type="button"
              className="view-row-btn"
              onClick={(e) => {
                e.stopPropagation();
                onCancelDelete();
              }}
            >
              Keep view
            </button>
          </>
        ) : (
          <button
            type="button"
            className="view-row-btn danger"
            aria-label="Delete view"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteClick();
            }}
          >
            <FontAwesomeIcon icon={faTrash} />
          </button>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Sub-component: ViewStatusBadge — one of materialized | pending | over_threshold | error
// ===========================================================================

type ViewStatusBadgeProps = {
  status: DynamicViewStatus | undefined;
  reason: DynamicViewReason | undefined;
  error: string | undefined;
};

function ViewStatusBadge({
  status,
  reason,
  error,
}: ViewStatusBadgeProps): JSX.Element | null {
  if (!status) return null;
  if (status === "materialized") {
    return (
      <span
        className="view-status-badge materialized"
        data-testid="view-status-badge"
        data-status="materialized"
        title="Materialized"
      >
        <FontAwesomeIcon icon={faCheck} />
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span
        className="view-status-badge pending"
        data-testid="view-status-badge"
        data-status="pending"
        title="Materializing…"
      >
        <FontAwesomeIcon icon={faSpinner} spin />
      </span>
    );
  }
  if (status === "over_threshold") {
    const title = reason === "no_filter" ? "No filter active" : "Exceeds max records";
    return (
      <span
        className="view-status-badge over_threshold"
        data-testid="view-status-badge"
        data-status="over_threshold"
        title={title}
      >
        <FontAwesomeIcon icon={faTriangleExclamation} />
      </span>
    );
  }
  // status === "error"
  return (
    <span
      className="view-status-badge error"
      data-testid="view-status-badge"
      data-status="error"
      title={error ?? "Error"}
    >
      <FontAwesomeIcon icon={faCircleExclamation} />
    </span>
  );
}
