import { useEffect, useRef, useState } from "react";
import {
  listTables,
  updateTable,
  deleteTableEntry,
  createTableEntry,
  fetchKineticaSchemas,
  fetchKineticaTables,
  fetchKineticaColumns,
  TableDto
} from "../api/client";
import { useApiQuery } from "../hooks/useApiQuery";
import { useAuthStore } from "../store/auth";
import {
  openTableUrl, clearTableUrl, setTableMode, leaveTableUrl,
  readTableIdFromSearch, type TableMode,
} from "../lib/tableUrl";
import ChartCard from "./ChartCard";
import ColumnFormatEditorModal from "./ColumnFormatEditorModal";
import CustomMetricsEditorModal from "./CustomMetricsEditorModal";

type View =
  | { mode: "list" }
  | { mode: "view"; table: TableDto }
  | { mode: "edit"; table: TableDto }
  | { mode: "create" };

const DatasetsPage = ({ initialOpenTable }: {
  /** Phase 116 (TLINK-V121-02): a table resolved from ?table=<id>[&mode=edit] at boot, handed
   *  down by App.tsx. Consumed ONCE, by the useState initializer below. */
  initialOpenTable?: { table: TableDto; mode: TableMode };
} = {}) => {
  const { loading, data, error } = useApiQuery<TableDto[]>(() => listTables(), []);
  const [tables, setTables] = useState<TableDto[]>([]);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Phase 116 (TLINK-V121-02): a deep link mounts us straight into view/edit, so the LIST IS NEVER
  // RENDERED — that is the no-flash requirement, expressed structurally rather than asserted visually.
  // Lazy initializer on purpose: mount-only. A later prop change must never re-open a table.
  // Note what is NOT here: openTableUrl(). The user ARRIVED on this URL, so the current history entry
  // already carries ?table=<id>; pushing would manufacture a second entry and break the marker logic.
  // leaveTableUrl()'s unmarked-entry branch then correctly WRITES the list URL instead of
  // history.back()-ing the user out of the application.
  const [view, setView] = useState<View>(() =>
    initialOpenTable
      ? { mode: initialOpenTable.mode, table: initialOpenTable.table }
      : { mode: "list" },
  );

  // Sync tables from query data; local state used for delete mutations
  useEffect(() => {
    if (data) setTables(data);
  }, [data]);

  // Phase 116 (TLINK-V121-05/06): react to history navigation. TWO cases, neither of which ever
  // OPENS a table — resolving a URL into an open table is App.tsx's job via useDeepLinkTable.
  //  1. param absent -> the user navigated Back to the list; show the list.
  //  2. param present but we are NOT on a table -> browser FORWARD into an entry already left.
  //     The list is on screen, so a stale ?table=<id> would describe a screen the user is not on
  //     (TLINK-V121-06). Reconcile the bar down to the list, in place, via clearTableUrl().
  //
  // NOT handled here, deliberately: reconciling the MODE qualifier against the open view. There is
  // no UI path that reaches a differing mode on the same entry — the only way into edit is the list's
  // Edit button (a fresh push), and TableDetail has no Edit affordance. If one is ever added, this
  // handler needs a third case.
  useEffect(() => {
    const onPopState = () => {
      if (readTableIdFromSearch(window.location.search) === null) {
        setView({ mode: "list" });
      } else if (view.mode !== "view" && view.mode !== "edit") {
        clearTableUrl();
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [view.mode]);

  // Phase 116 (TLINK-V121-06): leaving the Datasets page by ANY route must clear the address bar.
  // App.tsx renders DatasetsPage conditionally, so a sidebar click to Dashboards/Settings fully
  // unmounts this component while the URL still says ?table=<id> — copying the link at that moment
  // shares the wrong screen.
  //
  // Deferred by one macrotask on purpose, mirroring DashboardsPage.tsx:635-654:
  //  (a) StrictMode runs mount -> cleanup -> mount on the SAME hook state in dev (main.tsx:14); the
  //      spurious cleanup fires right after we pushed the URL, and deferring lets the re-mount cancel it.
  //  (b) it lets the auth status settle, so a 401/logout teardown is reliably seen as unauthenticated.
  // NOT cleared on logout/401: the logged-out journey (Plan 05) needs the id to survive re-auth.
  const openTableIdRef = useRef<number | null>(null);
  useEffect(() => {
    openTableIdRef.current =
      view.mode === "view" || view.mode === "edit" ? view.table.id : null;
  }, [view]);

  const clearUrlTimer = useRef<number | null>(null);
  useEffect(() => {
    if (clearUrlTimer.current !== null) {
      clearTimeout(clearUrlTimer.current);   // StrictMode re-mount: cancel the spurious clear
      clearUrlTimer.current = null;
    }
    return () => {
      // Capture the id at CLEANUP time, not at mount: unlike DashboardOpen (one instance per
      // dashboard), this component outlives every table it opens, so the id is only known now.
      const openedId = openTableIdRef.current;
      clearUrlTimer.current = window.setTimeout(() => {
        if (openedId === null) return;                                              // no table was open
        if (useAuthStore.getState().status !== "authenticated") return;             // 401/logout: leave it
        if (readTableIdFromSearch(window.location.search) !== openedId) return;     // not OUR param
        clearTableUrl();
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount-lifetime effect
  }, []);

  const handleDelete = (table: TableDto) => {
    if (!window.confirm(`Delete dataset "${table.name}"?`)) return;
    deleteTableEntry(table.id)
      .then(() => setTables((prev) => prev.filter((t) => t.id !== table.id)))
      .catch((err) => setDeleteError(err.message));
  };

  if (view.mode === "create") {
    return (
      <TableCreate
        onBack={() => setView({ mode: "list" })}
        onSaved={(created) => {
          setTables((prev) => [created, ...prev]);
          openTableUrl(created.id, "view");
          setView({ mode: "view", table: created });
        }}
      />
    );
  }

  if (view.mode === "view") {
    return (
      <TableDetail
        table={view.table}
        onBack={() => { leaveTableUrl(); setView({ mode: "list" }); }}
      />
    );
  }

  if (view.mode === "edit") {
    return (
      <TableEdit
        table={view.table}
        onBack={() => { leaveTableUrl(); setView({ mode: "list" }); }}
        onSaved={(updated) => {
          setTables((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
          // In-place mode change on the SAME entry — not a leave, not a fresh open;
          // setTableMode preserves whether this entry is ours or arrived-on, which
          // leaveTableUrl() must still read correctly afterwards.
          setTableMode(updated.id, "view");
          setView({ mode: "view", table: updated });
        }}
      />
    );
  }

  return (
    <div className="dashboard-list">
      <ChartCard
        title="Datasets"
        description="All registered tables from the backend"
        actions={
          <button className="btn-primary" onClick={() => setView({ mode: "create" })}>
            + New Dataset
          </button>
        }
      >
        {loading && <div className="muted">Loading tables…</div>}
        {error && error.kind === "permission" && (
          <div className="widget-permission-denied">Permission denied</div>
        )}
        {error && error.kind !== "permission" && (
          <div className="error">{error.message}</div>
        )}
        {deleteError && <div className="error">{deleteError}</div>}
        {!loading && !error && tables.length === 0 && <div className="muted">No tables yet.</div>}
        {!loading && !error && tables.length > 0 && (
          <div className="datasets-table">
            <div className="ds-header">
              <span>Name</span>
              <span>Schema</span>
              <span>Columns</span>
              <span>Updated</span>
              <span>Actions</span>
            </div>
            {tables.map((t) => (
              <div key={t.id} className="ds-row">
                <span className="ds-name">{t.name}</span>
                <span className="ds-schema">{t.schema}</span>
                <span>{Object.keys(t.columns).length}</span>
                <span className="ds-meta">{new Date(t.updated_at).toLocaleString()}</span>
                <span className="ds-actions">
                  <button className="ghost-sm" onClick={() => { openTableUrl(t.id, "view"); setView({ mode: "view", table: t }); }}>
                    View
                  </button>
                  <button className="ghost-sm" onClick={() => { openTableUrl(t.id, "edit"); setView({ mode: "edit", table: t }); }}>
                    Edit
                  </button>
                  <button className="ghost-sm ghost-danger" onClick={() => handleDelete(t)}>
                    Delete
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </ChartCard>
    </div>
  );
};

const TableDetail = ({ table, onBack }: { table: TableDto; onBack: () => void }) => {
  const columns = Object.entries(table.columns);
  const [showFormatEditor, setShowFormatEditor] = useState(false);
  const [showMetricsEditor, setShowMetricsEditor] = useState(false);

  return (
    <div className="dashboard-list">
      <ChartCard
        title={table.name}
        description={table.description || `Schema: ${table.schema}`}
        actions={
          <>
            <button className="ghost-sm" onClick={() => setShowFormatEditor(true)}>
              Format columns
            </button>
            <button className="ghost-sm" onClick={() => setShowMetricsEditor(true)}>
              Custom metrics
            </button>
            <button className="ghost-sm" onClick={onBack}>
              Back
            </button>
          </>
        }
      >
        <div className="ds-detail">
          <div className="ds-detail-row">
            <span className="ds-detail-label">Schema</span>
            <span>{table.schema}</span>
          </div>
          {table.description && (
            <div className="ds-detail-row">
              <span className="ds-detail-label">Description</span>
              <span>{table.description}</span>
            </div>
          )}
          <div className="ds-detail-row">
            <span className="ds-detail-label">Created</span>
            <span>{new Date(table.created_at).toLocaleString()}</span>
          </div>
          <div className="ds-detail-row">
            <span className="ds-detail-label">Updated</span>
            <span>{new Date(table.updated_at).toLocaleString()}</span>
          </div>
        </div>

        {columns.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Column</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {columns.map(([name, type]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ChartCard>
      {showFormatEditor && (
        <ColumnFormatEditorModal
          table={table}
          onClose={() => setShowFormatEditor(false)}
        />
      )}
      {showMetricsEditor && (
        <CustomMetricsEditorModal
          table={table}
          onClose={() => setShowMetricsEditor(false)}
        />
      )}
    </div>
  );
};

const TableEdit = ({
  table,
  onBack,
  onSaved
}: {
  table: TableDto;
  onBack: () => void;
  onSaved: (updated: TableDto) => void;
}) => {
  const [name, setName] = useState(table.name);
  const [schema, setSchema] = useState(table.schema);
  const [description, setDescription] = useState(table.description || "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = () => {
    setSaving(true);
    setSaveError(null);
    updateTable(table.id, { name, schema, description })
      .then(onSaved)
      .catch((err) => setSaveError(err.message))
      .finally(() => setSaving(false));
  };

  return (
    <div className="dashboard-list">
      <ChartCard
        title={`Edit: ${table.name}`}
        actions={
          <button className="ghost-sm" onClick={onBack}>
            Cancel
          </button>
        }
      >
        <div className="ds-form">
          <label className="ds-field">
            <span className="ds-field-label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="ds-field">
            <span className="ds-field-label">Schema</span>
            <input value={schema} onChange={(e) => setSchema(e.target.value)} />
          </label>
          <label className="ds-field">
            <span className="ds-field-label">Description</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          {saveError && <div className="error">{saveError}</div>}
          <button className="btn-primary" onClick={handleSave} disabled={saving || !name || !schema}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </ChartCard>
    </div>
  );
};

const TableCreate = ({
  onBack,
  onSaved
}: {
  onBack: () => void;
  onSaved: (created: TableDto) => void;
}) => {
  // Site 4: migrate schema discovery initial load to useApiQuery (stuck-spinner risk)
  const schemasQuery = useApiQuery<string[]>(() => fetchKineticaSchemas(), []);
  const schemas = schemasQuery.data ?? [];
  const schemasLoading = schemasQuery.loading;
  const schemasError = schemasQuery.error;

  const [selectedSchema, setSelectedSchema] = useState("");
  const [kTables, setKTables] = useState<string[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);

  const [selectedTable, setSelectedTable] = useState("");
  const [columns, setColumns] = useState<Record<string, string>>({});
  const [columnsLoading, setColumnsLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSchemaChange = (schema: string) => {
    setSelectedSchema(schema);
    setSelectedTable("");
    setColumns({});
    if (!schema) {
      setKTables([]);
      return;
    }
    setTablesLoading(true);
    fetchKineticaTables(schema)
      .then(setKTables)
      .catch((err) => setError(err.message))
      .finally(() => setTablesLoading(false));
  };

  const handleTableChange = (table: string) => {
    setSelectedTable(table);
    setColumns({});
    if (!table || !selectedSchema) return;
    setColumnsLoading(true);
    fetchKineticaColumns(selectedSchema, table)
      .then(setColumns)
      .catch((err) => setError(err.message))
      .finally(() => setColumnsLoading(false));
  };

  const handleSave = () => {
    setSaving(true);
    setError(null);
    createTableEntry({
      name: selectedTable,
      schema: selectedSchema,
      columns
    })
      .then(onSaved)
      .catch((err) => setError(err.message))
      .finally(() => setSaving(false));
  };

  const columnEntries = Object.entries(columns);

  return (
    <div className="dashboard-list">
      <ChartCard
        title="New Dataset"
        description="Select a Kinetica schema and table to register"
        actions={
          <button className="ghost-sm" onClick={onBack}>
            Cancel
          </button>
        }
      >
        <div className="ds-form">
          <label className="ds-field">
            <span className="ds-field-label">Schema</span>
            {schemasLoading && <div className="muted">Loading schemas…</div>}
            {schemasError && schemasError.kind === "permission" && (
              <div className="widget-permission-denied">Permission denied</div>
            )}
            {schemasError && schemasError.kind !== "permission" && (
              <div className="error">{schemasError.message}</div>
            )}
            {!schemasLoading && !schemasError && (
              <select
                className="ds-select"
                value={selectedSchema}
                onChange={(e) => handleSchemaChange(e.target.value)}
              >
                <option value="">Select a schema…</option>
                {schemas.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
          </label>

          {selectedSchema && (
            <label className="ds-field">
              <span className="ds-field-label">Table</span>
              {tablesLoading && <div className="muted">Loading tables…</div>}
              {!tablesLoading && (
                <select
                  className="ds-select"
                  value={selectedTable}
                  onChange={(e) => handleTableChange(e.target.value)}
                >
                  <option value="">Select a table…</option>
                  {kTables.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              )}
            </label>
          )}

          {columnsLoading && <div className="muted">Loading columns…</div>}

          {selectedTable && columnEntries.length > 0 && (
            <div className="ds-columns-preview">
              <span className="ds-field-label">Columns ({columnEntries.length})</span>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {columnEntries.map(([name, type]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {error && <div className="error">{error}</div>}

          {selectedTable && columnEntries.length > 0 && (
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save Dataset"}
            </button>
          )}
        </div>
      </ChartCard>
    </div>
  );
};

export default DatasetsPage;
