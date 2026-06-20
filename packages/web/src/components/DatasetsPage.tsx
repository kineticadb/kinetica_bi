import { useEffect, useState } from "react";
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
import ChartCard from "./ChartCard";
import ColumnFormatEditorModal from "./ColumnFormatEditorModal";

type View =
  | { mode: "list" }
  | { mode: "view"; table: TableDto }
  | { mode: "edit"; table: TableDto }
  | { mode: "create" };

const DatasetsPage = () => {
  const { loading, data, error } = useApiQuery<TableDto[]>(() => listTables(), []);
  const [tables, setTables] = useState<TableDto[]>([]);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ mode: "list" });

  // Sync tables from query data; local state used for delete mutations
  useEffect(() => {
    if (data) setTables(data);
  }, [data]);

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
          setView({ mode: "view", table: created });
        }}
      />
    );
  }

  if (view.mode === "view") {
    return <TableDetail table={view.table} onBack={() => setView({ mode: "list" })} />;
  }

  if (view.mode === "edit") {
    return (
      <TableEdit
        table={view.table}
        onBack={() => setView({ mode: "list" })}
        onSaved={(updated) => {
          setTables((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
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
                  <button className="ghost-sm" onClick={() => setView({ mode: "view", table: t })}>
                    View
                  </button>
                  <button className="ghost-sm" onClick={() => setView({ mode: "edit", table: t })}>
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
