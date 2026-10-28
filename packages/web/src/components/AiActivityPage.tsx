/**
 * AiActivityPage.tsx — Phase 142, AIGOV-V20-05.
 * Read-only view of the ai_audit log. It never shows row values because none are stored.
 * All server text (questions, answers, SQL) renders as plain text.
 */

import { useEffect, useState } from "react";
import {
  listAiAudit,
  getAiAuditEntry,
  listAiAuditDashboards,
} from "../api/client";
import type {
  AiAuditRowDto,
  AiAuditDetailDto,
  AiAuditDashboardsDto,
  AiAuditDashboardState,
} from "../api/client";
import "./AiActivityPage.css";

const KIND_LABEL = { ask: "Ask", generate: "Generate", keep: "Keep" } as const;
const OUTCOME_LABEL: Record<string, string> = {
  ok: "Answered",
  cancelled: "Cancelled",
  capped: "Limit reached",
  provider_error: "Failed",
  rate_limited: "Rate-limited",
  kept: "Kept",
  keep_conflict: "Keep conflict",
  keep_denied: "Keep denied",
  keep_invalid: "Keep invalid",
  keep_failed: "Keep failed",
};
export const AI_ACTIVITY_COPY = {
  title: "AI activity",
  note: "Query results are never logged.",
  empty: "No AI activity in this period.",
  noTools: "No tools recorded.",
  timeoutTools: "The tools list can be incomplete for answers that timed out.",
} as const;

const DAY_MS = 86_400_000;
const PAGE_SIZE = 50;

const startOfDay = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
};
const endOfDay = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
};
const toIso = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const formatDuration = (ms: number | null): string => {
  if (ms === null || ms === undefined) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
};

const dashboardLabel = (id: number | null, name: string | null, state: AiAuditDashboardState): string => {
  if (state === "deleted") return `Deleted dashboard #${id}`;
  if (state === "pending") return `Dashboard #${id} (not kept yet)`;
  return name ?? "—";
};

const orDash = (v: string | number | null | undefined): string =>
  v === null || v === undefined || v === "" ? "—" : String(v);

function DashboardCell({ row }: { row: AiAuditRowDto }) {
  if (row.dashboardState === "none" || row.dashboardId === null) return <>—</>;
  if (row.dashboardState === "live") return <>{row.dashboardName ?? `Dashboard #${row.dashboardId}`}</>;
  return <span className="muted">{dashboardLabel(row.dashboardId, row.dashboardName, row.dashboardState)}</span>;
}

const countText = (n: number | null | undefined): string =>
  typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "—";

/** One stored rejection ({label, stage, reasons}) as "label: reason; reason"; anything else gives "". */
function rejectedLine(r: unknown): string {
  if (!r || typeof r !== "object") return "";
  const { label, reasons } = r as { label?: unknown; reasons?: unknown };
  if (typeof label !== "string" || !label) return "";
  const why = Array.isArray(reasons) ? reasons.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
  return why.length > 0 ? `${label}: ${why.join("; ")}` : label;
}

function Detail({ d, onClose }: { d: AiAuditDetailDto; onClose: () => void }) {
  const tools = Array.isArray(d.tools) ? d.tools : [];
  const queries = Array.isArray(d.queries) ? d.queries : [];
  const changes = d.changes as {
    applied?: string[];
    rejected?: unknown[];
    added?: unknown;
    edited?: unknown;
    removed?: unknown;
  } | null;
  const applied = Array.isArray(changes?.applied) ? changes!.applied! : [];
  const rejected = Array.isArray(changes?.rejected) ? changes!.rejected!.map(rejectedLine) : [];
  const rejectedCount = rejected.length;
  const hasChanges = !!changes && (applied.length > 0 || rejectedCount > 0);
  const modelText =
    d.provider || d.model ? `${orDash(d.provider)} / ${orDash(d.model)}` : "—";
  const tokenText =
    d.inputTokens === null && d.outputTokens === null
      ? "—"
      : `${countText(d.inputTokens)} in / ${countText(d.outputTokens)} out`;

  return (
    <section className="ai-activity-detail" aria-label="AI activity detail">
      <div className="config-group">
        <span className="config-group-label">{d.kind === "keep" ? "Summary" : "Question"}</span>
        <div>{d.kind === "keep" ? orDash(d.summary) : orDash(d.question)}</div>
      </div>
      {d.kind !== "keep" && (
        <div className="config-group">
          <span className="config-group-label">Answer</span>
          <div>{orDash(d.answerText)}</div>
        </div>
      )}
      {d.kind !== "keep" && (
        <div className="config-group">
          <span className="config-group-label">Tools used</span>
          {tools.length === 0 ? (
            <div className="muted">{AI_ACTIVITY_COPY.noTools}</div>
          ) : (
            <ul>
              {tools.map((t, i) => (
                <li key={i}>{`${t.name} (${t.result})`}</li>
              ))}
            </ul>
          )}
          {d.outcomeDetail === "timeout" && <div className="muted">{AI_ACTIVITY_COPY.timeoutTools}</div>}
        </div>
      )}
      {hasChanges && (
        <div className="config-group">
          <span className="config-group-label">Changes</span>
          {applied.length > 0 && (
            <ul>
              {applied.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
          {rejectedCount > 0 && <div>{`${rejectedCount} rejected`}</div>}
          {rejected.some(Boolean) && (
            <ul className="muted">
              {rejected.map((l, i) => (l ? <li key={i}>{l}</li> : null))}
            </ul>
          )}
        </div>
      )}
      {queries.length > 0 && (
        <div className="config-group">
          <span className="config-group-label">Queries</span>
          {queries.map((q, i) => (
            <div key={i}>
              <pre className="ai-activity-sql">{q.sql}</pre>
              <span className="muted">
                {[
                  q.rowCount !== undefined ? `${countText(q.rowCount)} rows` : null,
                  q.durationMs !== undefined ? `${q.durationMs} ms` : null,
                  q.outcome ?? null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="config-group">
        <span className="config-group-label">Details</span>
        <dl>
          <dt>Provider / model</dt>
          <dd>{modelText}</dd>
          <dt>Tokens</dt>
          <dd>{tokenText}</dd>
          <dt>Data access</dt>
          <dd>{orDash(d.dataAccess)}</dd>
          <dt>Allow-list version</dt>
          <dd>{orDash(d.allowListVersion)}</dd>
          <dt>Outcome detail</dt>
          <dd>{orDash(d.outcomeDetail)}</dd>
        </dl>
      </div>
      <div className="ds-actions">
        <button type="button" className="ghost-sm" onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  );
}

export function AiActivityPage() {
  const [to0] = useState(() => Date.now());
  const [from, setFrom] = useState(() => to0 - 7 * DAY_MS);
  const [to, setTo] = useState(to0);
  const [outcome, setOutcome] = useState("");
  const [dashboardId, setDashboardId] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<AiAuditRowDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [facet, setFacet] = useState<AiAuditDashboardsDto["dashboards"]>([]);
  const [detail, setDetail] = useState<AiAuditDetailDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    listAiAudit(
      { from, to, outcomes: outcome ? [outcome] : undefined, dashboardId, page },
      c.signal,
    )
      .then((r) => {
        if (c.signal.aborted) return;
        setRows(r.rows ?? []);
        setTotal(r.total ?? 0);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (c.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
        setError(e instanceof Error ? e.message : "Failed to load AI activity");
        setLoading(false);
      });
    return () => c.abort();
  }, [from, to, outcome, dashboardId, page]);

  useEffect(() => {
    const c = new AbortController();
    listAiAuditDashboards({ from, to }, c.signal)
      .then((r) => {
        if (!c.signal.aborted) setFacet(r.dashboards ?? []);
      })
      .catch(() => {
        /* facet is optional; the list reports its own errors */
      });
    return () => c.abort();
  }, [from, to]);

  const openDetail = (id: number) => {
    setDetailError(null);
    getAiAuditEntry(id, new AbortController().signal)
      .then((d) => setDetail(d))
      .catch((e: unknown) => setDetailError(e instanceof Error ? e.message : "Failed to load AI activity"));
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="users-page">
      <div className="users-page-header">
        <h2 className="users-page-title">{AI_ACTIVITY_COPY.title}</h2>
      </div>
      <p className="muted">{AI_ACTIVITY_COPY.note}</p>

      <div className="ai-activity-filters">
        <div className="ds-field">
          <label className="ds-field-label" htmlFor="ai-activity-from">From</label>
          <input
            id="ai-activity-from"
            type="date"
            className="ds-select"
            value={toIso(from)}
            onChange={(e) => {
              if (!e.target.value) return;
              setFrom(startOfDay(e.target.value));
              setPage(1);
            }}
          />
        </div>
        <div className="ds-field">
          <label className="ds-field-label" htmlFor="ai-activity-to">To</label>
          <input
            id="ai-activity-to"
            type="date"
            className="ds-select"
            value={toIso(to)}
            onChange={(e) => {
              if (!e.target.value) return;
              setTo(endOfDay(e.target.value));
              setPage(1);
            }}
          />
        </div>
        <div className="ds-field">
          <label className="ds-field-label" htmlFor="ai-activity-outcome">Outcome</label>
          <select
            id="ai-activity-outcome"
            className="ds-select"
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All outcomes</option>
            {Object.entries(OUTCOME_LABEL).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>
        <div className="ds-field">
          <label className="ds-field-label" htmlFor="ai-activity-dashboard">Dashboard</label>
          <select
            id="ai-activity-dashboard"
            className="ds-select"
            value={dashboardId === undefined ? "" : String(dashboardId)}
            onChange={(e) => {
              setDashboardId(e.target.value ? Number(e.target.value) : undefined);
              setPage(1);
            }}
          >
            <option value="">All dashboards</option>
            {facet.map((d) => (
              <option key={d.id} value={d.id}>
                {d.state === "live" ? (d.name ?? `Dashboard #${d.id}`) : dashboardLabel(d.id, d.name, d.state)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <p className="users-error error">{error}</p>
      ) : loading ? (
        <p className="users-loading">Loading AI activity&hellip;</p>
      ) : rows.length === 0 ? (
        <p className="muted">{AI_ACTIVITY_COPY.empty}</p>
      ) : (
        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                {["Time", "User", "Dashboard", "Kind", "Question", "Outcome", "Steps", "Duration"].map((h) => (
                  <th key={h} className="users-th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="users-tr ai-activity-row"
                  tabIndex={0}
                  onClick={() => openDetail(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") openDetail(r.id);
                  }}
                >
                  <td className="users-td">{new Date(r.ts).toLocaleString()}</td>
                  <td className="users-td">{r.username}</td>
                  <td className="users-td"><DashboardCell row={r} /></td>
                  <td className="users-td">{KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td className="users-td">{r.kind === "keep" ? orDash(r.summary) : r.question}</td>
                  <td className="users-td">
                    {r.outcome === null ? "Running" : (OUTCOME_LABEL[r.outcome] ?? r.outcome)}
                  </td>
                  <td className="users-td">{orDash(r.steps)}</td>
                  <td className="users-td">{formatDuration(r.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="ai-activity-paging">
        <div className="ds-actions">
          <button type="button" className="ghost-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <button type="button" className="ghost-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
        <span className="muted">{`Page ${page} of ${pages} · ${total} entries`}</span>
      </div>

      {detailError && <p className="error">{detailError}</p>}
      {detail && <Detail d={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
