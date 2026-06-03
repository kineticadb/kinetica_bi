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

/**
 * kineticaSql — POST /execute/sql with per-user credentials.
 *
 * Returns the parsed `encoded` shape (json_encoded_response → JSON.parse),
 * same contract as the existing index.ts:333-365 kineticaSql helper.
 * Throws on any failure.
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

  try {
    const response = await fetch(`${kineticaUrl.replace(/\/$/, "")}/execute/sql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: buildAuthHeader(req),
      },
      body: JSON.stringify({
        statement: sql,
        offset: 0,
        limit: 1000,
        encoding: "json",
        request_schema_str: "",
        data: [],
        options: {},
        ...(options.extra ?? {}),
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

    emitAudit({ ...baseAudit, outcome: "success", status: 200, duration_ms: Date.now() - start });
    return encoded ?? body;
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
 */
export const kineticaShowTable = async (
  req: AuthedRequest,
  tableName: string,
  options: { route: string; op: KineticaOp }
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
      body: JSON.stringify({ table_name: tableName, options: {} }),
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
