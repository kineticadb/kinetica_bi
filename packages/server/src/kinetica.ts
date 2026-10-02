/**
 * kinetica.ts — Per-request Kinetica helper module.
 *
 * Exports:
 *   kineticaSql(req, sql, options)  — POST /execute/sql, returns parsed encoded shape
 *   kineticaWms(req, queryString, options) — GET /wms, returns raw Response for streaming
 *
 * Every invocation:
 *   1. Builds Authorization header from req (credential-type-aware: Bearer in OIDC mode, Basic in password mode)
 *   2. Emits one JSON audit line to console.log: { ts, request_id, username, route, op, outcome, status, duration_ms, auth_mode }
 *   3. Emits raw upstream error/body to console.error (separate channel) on failure
 *   4. Throws typed errors:
 *      - KineticaAuthError       on HTTP 401
 *      - KineticaPermissionError on HTTP 403, or HTTP 400 with body.message matching /access denied|permission/i
 *      - KineticaUpstreamError   on any other failure (5xx, network throw, body.status==='ERROR', malformed)
 *
 * NO SQL body, WMS query string, or Authorization header appears in any log line.
 * Raw upstream error bodies go to console.error ONLY.
 */

import { randomUUID } from "node:crypto";
import type { AuthedRequest } from "./auth";
import {
  KineticaAuthError,
  KineticaPermissionError,
  KineticaUpstreamError,
} from "./kineticaErrors";

// Op enum drives the audit log "op" field — keep verbatim, do not localize.
// INFO_QUERY (v1.4 Phase 18) — POST /api/info/query map info popup spatial-proximity SQL.
// DYNAMIC_PREVIEW + DYNAMIC_MATERIALIZE (v1.6 Phase 32 Plan 03) — dynamic-view preview
// SELECT probe, materialize CREATE OR REPLACE + COUNT + DROP, and DELETE row drops.
// DYNAMIC_DROP (v1.6 Phase 33 Plan 02 — DV-V16-07) — POST /api/dynamic-view/:id/drop
// lifecycle-cleanup primitive used by frontend dynamicViewStore.reset() DROP loop;
// finer-grained audit tag distinguishes lifecycle DROPs from materialize-housekeeping.
export type KineticaOp =
  | "SQL"
  | "DISCOVERY"
  | "MATERIALIZE"
  | "WMS"
  | "INFO_QUERY"
  | "DYNAMIC_PREVIEW"
  | "DYNAMIC_MATERIALIZE"
  | "DYNAMIC_DROP"
  // QUANTILE (v1.7 Phase 38 — SCHEMA-V17-06): POST /api/quantile NTILE bucket-MIN
  // quantile query backing Phase 39 Auto-suggest classbreak boundaries. Single-shot
  // SQL operation (no DDL); separate op tag for audit granularity.
  | "QUANTILE"
  // TOP_VALUES (v1.7 post-Phase-39 UAT): POST /api/top-values GROUP BY + COUNT(*)
  // top-N distinct values backing categorical Auto-suggest in the Class Break form.
  | "TOP_VALUES"
  // COLUMN_STATS (v1.7 post-Phase-39 UAT): POST /api/column-stats MIN/MAX/AVG/STDDEV
  // backing Equal-Interval + Standard-Deviation numeric classification methods.
  | "COLUMN_STATS";

export type KineticaSqlOptions = {
  route: string; // e.g., "POST /api/sql" — appears verbatim in audit log
  op: KineticaOp; // SQL | DISCOVERY | MATERIALIZE — drives log filtering
  extra?: Record<string, unknown>; // merged into the Kinetica request body's `options`
  // and TOP-LEVEL fields (matches existing /api/sql shape at index.ts:457-466)
};

export type KineticaWmsOptions = {
  route: string; // e.g., "GET /api/wms"
  // op is fixed as "WMS" internally; not parameterized.
};

type AuditOutcome = "success" | "auth-fail" | "permission-denied" | "upstream-error";

// Build Authorization header from per-request session creds — never from env vars.
// Credential-type-aware: OIDC sessions send Bearer <access_token>; password sessions send Basic.
// PITFALLS I-01: discriminant is credentialType (string-literal union), NOT the truthiness of creds.password.
const buildAuthHeader = (req: AuthedRequest): string => {
  const { credentialType, creds } = req.user!;
  if (credentialType === "oidc") {
    return `Bearer ${creds.token}`;
  }
  return `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}`;
};

// Emit a single-line JSON audit record to console.log (clean, parseable channel).
// No SQL body, no WMS query string, no Authorization header.
const emitAudit = (fields: {
  request_id: string;
  username: string;
  route: string;
  op: KineticaOp;
  outcome: AuditOutcome;
  status: number;
  duration_ms: number;
  auth_mode: "password" | "oidc";
}): void => {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      request_id: fields.request_id,
      username: fields.username,
      route: fields.route,
      op: fields.op,
      outcome: fields.outcome,
      status: fields.status,
      duration_ms: fields.duration_ms,
      auth_mode: fields.auth_mode,
    })
  );
};

/**
 * Inspect an HTTP response (non-2xx) and throw the appropriate typed error.
 * Handles:
 *   - 401 → KineticaAuthError
 *   - 403 → KineticaPermissionError
 *   - 400 + body.message matches /access denied|permission/i → KineticaPermissionError
 *     (Kinetica DDL-denial signals via HTTP 400 — see SPIKE.md from 02-01)
 *   - anything else → KineticaUpstreamError
 */
const classifyHttpError = async (response: Response): Promise<never> => {
  const status = response.status;
  if (status === 401) {
    throw new KineticaAuthError("Kinetica rejected credentials", 401);
  }
  if (status === 403) {
    throw new KineticaPermissionError("Kinetica permission denied", 403);
  }
  if (status === 400) {
    // Attempt to read body to check for access-denied message
    let body: { status?: string; message?: string } | null = null;
    try {
      body = await response.json();
    } catch {
      // non-JSON 400 — treat as upstream error
    }
    if (body?.message && /access denied|permission/i.test(body.message)) {
      throw new KineticaPermissionError("Kinetica permission denied", 400);
    }
    // 400 without access-denied body → upstream error
    const rawMsg = body?.message ?? `Kinetica returned ${status}`;
    throw new KineticaUpstreamError(rawMsg, status);
  }
  // All other non-OK statuses
  let text = "";
  try {
    text = await response.text();
  } catch {
    // ignore
  }
  throw new KineticaUpstreamError(
    `Kinetica returned ${status}${text ? `: ${text.slice(0, 80)}` : ""}`,
    status
  );
};

// ---------------------------------------------------------------------------
// Phase 127 — row-limit ceiling. Read per call (kinetica.ts has no boot hook).
// ---------------------------------------------------------------------------
export const DEFAULT_MAX_ROWS_PER_QUERY = 20_000;
// Kinetica's max_get_records_size default; no single call may exceed it.
export const DEFAULT_MAX_RECORDS_PER_CALL = 20_000;
export type RowLimitConfig = { maxRowsPerQuery: number; maxRecordsPerCall: number };

const warnedRowLimitEnv = new Set<string>();

const readRowLimitEnv = (name: string, def: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    const key = `${name}=${raw}`;
    if (!warnedRowLimitEnv.has(key)) {
      warnedRowLimitEnv.add(key);
      console.warn(
        `[kinetica] ${name} must be a positive integer (got: ${JSON.stringify(raw)}); falling back to default ${def}`
      );
    }
    return def;
  }
  return n;
};

export const getRowLimitConfig = (): RowLimitConfig => ({
  maxRowsPerQuery: readRowLimitEnv("KINETICA_MAX_ROWS_PER_QUERY", DEFAULT_MAX_ROWS_PER_QUERY),
  maxRecordsPerCall: readRowLimitEnv("KINETICA_MAX_RECORDS_PER_CALL", DEFAULT_MAX_RECORDS_PER_CALL),
});

export const __resetRowLimitWarningsForTest = (): void => {
  warnedRowLimitEnv.clear();
  warnedBatchExceedsServerMax = false;
};

const isPositiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

let warnedBatchExceedsServerMax = false;

const warnBatchExceedsServerMaxOnce = (maxRecordsPerCall: number, callLimit: number, n: number): void => {
  if (warnedBatchExceedsServerMax) return;
  warnedBatchExceedsServerMax = true;
  console.warn(
    `[kinetica] KINETICA_MAX_RECORDS_PER_CALL=${maxRecordsPerCall} exceeds this Kinetica server's max_get_records_size (a call asking for ${callLimit} rows returned ${n} with has_more_records=true); continuing to page. Lower KINETICA_MAX_RECORDS_PER_CALL to match the server.`
  );
};

const NON_DATA_KEYS = new Set(["column_headers", "column_datatypes"]);

const rowCount = (encoded: unknown): number => {
  if (!encoded || typeof encoded !== "object" || Array.isArray(encoded)) return 0;
  for (const [k, v] of Object.entries(encoded as Record<string, unknown>)) {
    if (!NON_DATA_KEYS.has(k) && Array.isArray(v)) return v.length;
  }
  return 0;
};

const mergeChunks = (acc: unknown, chunk: unknown): unknown => {
  if (acc === undefined) return chunk;
  if (!acc || typeof acc !== "object" || !chunk || typeof chunk !== "object") return acc;
  const out = { ...(acc as Record<string, unknown>) };
  for (const [k, v] of Object.entries(chunk as Record<string, unknown>)) {
    if (NON_DATA_KEYS.has(k)) continue;
    if (Array.isArray(v) && Array.isArray(out[k])) out[k] = [...(out[k] as unknown[]), ...v];
  }
  return out;
};

type SqlPage = {
  encoded: unknown;
  hasMore: boolean | undefined;
  total: number | undefined;
  body: unknown;
};

/**
 * kineticaSql — POST /execute/sql with per-user credentials.
 *
 * Returns the parsed `encoded` shape (json_encoded_response -> JSON.parse),
 * same contract as the existing index.ts:333-365 kineticaSql helper.
 * Throws on any failure.
 *
 * Phase 127: the envelope limit is the deploy-time per-query max
 * (KINETICA_MAX_ROWS_PER_QUERY, default 20,000), every caller's extra.limit is clamped to
 * it, and no single call asks for more than KINETICA_MAX_RECORDS_PER_CALL rows — a larger
 * limit is served by several ordered calls (offset advances) whose columns are concatenated.
 * has_more_records (never a short page) is the continuation signal.
 */
export const kineticaSql = async (
  req: AuthedRequest,
  sql: string,
  options: KineticaSqlOptions
): Promise<unknown> => {
  const start = Date.now();
  const username = req.user?.creds?.username ?? "unknown";
  const requestId = req.requestId ?? randomUUID();
  const baseAudit = {
    request_id: requestId,
    username,
    route: options.route,
    op: options.op,
    auth_mode: req.user!.credentialType,
  };
  const kineticaUrl = process.env.KINETICA_URL!;
  const { maxRowsPerQuery, maxRecordsPerCall } = getRowLimitConfig();
  // Clamp inside kineticaSql so every caller (untrusted /api/sql options AND internal pins) is bound (D-04/D-05).
  const { limit: reqLimit, offset: reqOffset, ...restExtra } = (options.extra ?? {}) as Record<
    string,
    unknown
  >;
  const effectiveLimit = isPositiveInt(reqLimit) ? Math.min(reqLimit, maxRowsPerQuery) : maxRowsPerQuery;
  const baseOffset =
    typeof reqOffset === "number" && Number.isInteger(reqOffset) && reqOffset >= 0 ? reqOffset : 0;

  const postPage = async (offset: number, limit: number): Promise<SqlPage> => {
    const response = await fetch(`${kineticaUrl.replace(/\/$/, "")}/execute/sql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: buildAuthHeader(req),
      },
      body: JSON.stringify({
        statement: sql,
        encoding: "json",
        request_schema_str: "",
        data: [],
        options: {},
        ...restExtra,
        offset,
        limit,
      }),
    });

    // --- Error path: non-OK status codes ---
    if (!response.ok) {
      let thrownError: KineticaAuthError | KineticaPermissionError | KineticaUpstreamError;
      try {
        await classifyHttpError(response);
        // classifyHttpError always throws, but TypeScript doesn't know that
        throw new KineticaUpstreamError("unreachable");
      } catch (e) {
        thrownError = e as KineticaAuthError | KineticaPermissionError | KineticaUpstreamError;
      }

      const outcome: AuditOutcome =
        thrownError instanceof KineticaAuthError
          ? "auth-fail"
          : thrownError instanceof KineticaPermissionError
            ? "permission-denied"
            : "upstream-error";

      emitAudit({ ...baseAudit, outcome, status: 502, duration_ms: Date.now() - start });
      console.error("[kinetica]", options.route, response.status, thrownError.message);
      throw thrownError;
    }

    // --- Success path: parse response body ---
    const body = await response.json().catch(() => null);

    if (!body || body.status === "ERROR") {
      emitAudit({ ...baseAudit, outcome: "upstream-error", status: 502, duration_ms: Date.now() - start });
      console.error("[kinetica]", options.route, "body.status === ERROR", body);
      throw new KineticaUpstreamError(
        body?.message ? "Kinetica returned ERROR" : "Kinetica returned empty response",
        response.status
      );
    }

    // Reuse body-parse from existing index.ts:355-364
    const dataStr =
      typeof body.data_str === "string" ? JSON.parse(body.data_str) : body.data_str;
    const encoded =
      typeof dataStr?.json_encoded_response === "string"
        ? JSON.parse(dataStr.json_encoded_response)
        : dataStr?.json_encoded_response;
    return {
      encoded,
      hasMore: typeof dataStr?.has_more_records === "boolean" ? dataStr.has_more_records : undefined,
      total:
        typeof dataStr?.total_number_of_records === "number"
          ? dataStr.total_number_of_records
          : undefined,
      body,
    };
  };

  try {
    // Row-order stability across split calls without a unique ORDER BY is not documented by
    // Kinetica — verified live at the Phase 127 checkpoint / Phase 128 spike.
    let fetched = 0;
    let merged: unknown = undefined;
    let first: SqlPage | undefined;
    let lastHasMore: boolean | undefined;
    let lastTotal: number | undefined;
    while (fetched < effectiveLimit) {
      const callLimit = Math.min(maxRecordsPerCall, effectiveLimit - fetched);
      const r = await postPage(baseOffset + fetched, callLimit);
      first ??= r;
      const n = rowCount(r.encoded);
      merged = mergeChunks(merged, r.encoded);
      fetched += n;
      lastHasMore = r.hasMore;
      lastTotal = r.total ?? lastTotal;
      if (r.hasMore !== true || n === 0) break;
      // D-11: a short page flagged has_more_records is NOT the end; keep paging.
      if (n < callLimit) warnBatchExceedsServerMaxOnce(maxRecordsPerCall, callLimit, n);
    }

    emitAudit({ ...baseAudit, outcome: "success", status: 200, duration_ms: Date.now() - start });
    if (merged && typeof merged === "object" && !Array.isArray(merged)) {
      return {
        ...(merged as Record<string, unknown>),
        ...(typeof lastHasMore === "boolean" ? { has_more_records: lastHasMore } : {}),
        ...(typeof lastTotal === "number" ? { total_number_of_records: lastTotal } : {}),
      };
    }
    return (first?.encoded as unknown) ?? first?.body;
  } catch (error) {
    // Re-throw typed errors immediately (they've already emitted audit + console.error)
    if (
      error instanceof KineticaAuthError ||
      error instanceof KineticaPermissionError ||
      error instanceof KineticaUpstreamError
    ) {
      throw error;
    }
    // Network throw / unexpected JS error
    emitAudit({
      ...baseAudit,
      outcome: "upstream-error",
      status: 502,
      duration_ms: Date.now() - start,
    });
    console.error("[kinetica]", options.route, "network/throw", error);
    throw new KineticaUpstreamError("Failed to reach Kinetica");
  }
};

/**
 * kineticaShowTable — POST /show/table with per-user credentials.
 *
 * Returns the decoded show_table_response object (REST envelope's `data_str`
 * JSON-parsed), which carries `table_names`, `properties`, `type_schemas`, etc.
 * Unlike /execute/sql there is NO `json_encoded_response` nesting — the parsed
 * `data_str` IS the response. Throws the same typed errors as kineticaSql.
 *
 * Used by the column-discovery route to recover TIMESTAMP/DATE/TIME/DATETIME
 * sub-types that INFORMATION_SCHEMA.COLUMNS.DATA_TYPE drops (it reports the base
 * `bigint`/`long` storage type). See lib/showTableTypes.ts.
 *
 * `showOptions` is spread into the Kinetica request's own `options` map. Phase 122's
 * schema check passes `{ no_error_if_not_exists: "true" }` so that a table Kinetica
 * no longer has returns HTTP 200 with an empty `table_names` instead of a
 * `status: "ERROR"` body — which this function maps to `KineticaUpstreamError`, the
 * SAME class a genuine connection failure produces. Without that option, "table
 * missing" and "could not reach Kinetica" are indistinguishable by exception type.
 * Verified against the live instance — see
 * `.planning/phases/122-schema-diff-table-missing-detection/122-SPIKE-NOTES.md` Q5.
 */
export const kineticaShowTable = async (
  req: AuthedRequest,
  tableName: string,
  options: { route: string; op: KineticaOp; showOptions?: Record<string, string> }
): Promise<unknown> => {
  const start = Date.now();
  const username = req.user?.creds?.username ?? "unknown";
  const requestId = req.requestId ?? randomUUID();
  const baseAudit = {
    request_id: requestId,
    username,
    route: options.route,
    op: options.op,
    auth_mode: req.user!.credentialType,
  };
  const kineticaUrl = process.env.KINETICA_URL!;

  try {
    const response = await fetch(`${kineticaUrl.replace(/\/$/, "")}/show/table`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: buildAuthHeader(req),
      },
      body: JSON.stringify({ table_name: tableName, options: { ...(options.showOptions ?? {}) } }),
    });

    if (!response.ok) {
      let thrownError: KineticaAuthError | KineticaPermissionError | KineticaUpstreamError;
      try {
        await classifyHttpError(response);
        throw new KineticaUpstreamError("unreachable");
      } catch (e) {
        thrownError = e as KineticaAuthError | KineticaPermissionError | KineticaUpstreamError;
      }
      const outcome: AuditOutcome =
        thrownError instanceof KineticaAuthError
          ? "auth-fail"
          : thrownError instanceof KineticaPermissionError
            ? "permission-denied"
            : "upstream-error";
      emitAudit({ ...baseAudit, outcome, status: 502, duration_ms: Date.now() - start });
      console.error("[kinetica]", options.route, response.status, thrownError.message);
      throw thrownError;
    }

    const body = await response.json().catch(() => null);
    if (!body || body.status === "ERROR") {
      emitAudit({ ...baseAudit, outcome: "upstream-error", status: 502, duration_ms: Date.now() - start });
      console.error("[kinetica]", options.route, "body.status === ERROR", body);
      throw new KineticaUpstreamError(
        body?.message ? "Kinetica returned ERROR" : "Kinetica returned empty response",
        response.status
      );
    }

    // /show/table: the response object is the JSON-parsed `data_str` (no
    // json_encoded_response nesting). Fall back to the raw body if data_str absent.
    const decoded =
      typeof body.data_str === "string" ? JSON.parse(body.data_str) : body.data_str;

    emitAudit({ ...baseAudit, outcome: "success", status: 200, duration_ms: Date.now() - start });
    return decoded ?? body;
  } catch (error) {
    if (
      error instanceof KineticaAuthError ||
      error instanceof KineticaPermissionError ||
      error instanceof KineticaUpstreamError
    ) {
      throw error;
    }
    emitAudit({ ...baseAudit, outcome: "upstream-error", status: 502, duration_ms: Date.now() - start });
    console.error("[kinetica]", options.route, "network/throw", error);
    throw new KineticaUpstreamError("Failed to reach Kinetica");
  }
};

/**
 * kineticaWms — GET /wms with per-user credentials.
 *
 * Returns the raw fetch Response. Caller streams the body itself (binary tile pass-through).
 * Throws BEFORE returning the Response on auth/permission/upstream failures so the caller
 * never sees a 4xx/5xx Response and accidentally streams an HTML error page back to the browser.
 */
export const kineticaWms = async (
  req: AuthedRequest,
  queryString: string, // already-built ?key=val&... string (caller does URLSearchParams)
  options: KineticaWmsOptions
): Promise<Response> => {
  const start = Date.now();
  const username = req.user?.creds?.username ?? "unknown";
  const requestId = req.requestId ?? randomUUID();
  const baseAudit = {
    request_id: requestId,
    username,
    route: options.route,
    op: "WMS" as const,
    auth_mode: req.user!.credentialType,
  };
  const kineticaUrl = process.env.KINETICA_URL!;

  try {
    const response = await fetch(`${kineticaUrl.replace(/\/$/, "")}/wms?${queryString}`, {
      headers: {
        Authorization: buildAuthHeader(req),
      },
    });

    // --- Error path: non-OK status codes ---
    if (!response.ok) {
      let thrownError: KineticaAuthError | KineticaPermissionError | KineticaUpstreamError;
      try {
        await classifyHttpError(response);
        throw new KineticaUpstreamError("unreachable");
      } catch (e) {
        thrownError = e as KineticaAuthError | KineticaPermissionError | KineticaUpstreamError;
      }

      const outcome: AuditOutcome =
        thrownError instanceof KineticaAuthError
          ? "auth-fail"
          : thrownError instanceof KineticaPermissionError
            ? "permission-denied"
            : "upstream-error";

      emitAudit({ ...baseAudit, outcome, status: 502, duration_ms: Date.now() - start });
      console.error("[kinetica]", options.route, response.status, thrownError.message);
      throw thrownError;
    }

    emitAudit({ ...baseAudit, outcome: "success", status: 200, duration_ms: Date.now() - start });
    return response;
  } catch (error) {
    // Re-throw typed errors immediately
    if (
      error instanceof KineticaAuthError ||
      error instanceof KineticaPermissionError ||
      error instanceof KineticaUpstreamError
    ) {
      throw error;
    }
    // Network throw / unexpected JS error
    emitAudit({
      ...baseAudit,
      outcome: "upstream-error",
      status: 502,
      duration_ms: Date.now() - start,
    });
    console.error("[kinetica]", options.route, "network/throw", error);
    throw new KineticaUpstreamError("Failed to reach Kinetica WMS");
  }
};
