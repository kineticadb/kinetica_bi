/**
 * Phase 128 EXPRT-V126-05/07/16 — in-process export runner.
 *
 * Background job, no queue library. Credentials are re-derived from the session
 * before every Kinetica call and never stored. Only complete, closed files exist
 * on disk (<jobId>.csv.part is renamed after the count check).
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createZipEntryStages, type ZipEntryOptions } from "./zipStream";
import { exportDownloadBase } from "./exportName";
import { csvLine } from "./csvExport";
import { getRowLimitConfig, kineticaSql, type KineticaPrincipal } from "../kinetica";
import { getSession, deleteSession } from "../sessionStore";
import { KineticaAuthError, KineticaPermissionError, KineticaUpstreamError } from "../kineticaErrors";
import { createOrReplaceMaterialized } from "./materializedView";
import {
  buildExportPlan,
  buildHeaderProbeSql,
  buildBatchRequest,
  type ExportPlan,
  type ExportSpec,
} from "./exportSql";
import {
  getWidget,
  getTable,
  getDashboardDynamicView,
  insertExportJob,
  getExportJob,
  markExportJobRunning,
  setExportJobTotalRows,
  updateExportJobProgress,
  finalizeExportJob,
  listActiveExportJobIdsForUser,
  listColumnDisplayConfig,
} from "../db";
import { buildFormatter, type FormatSpec } from "./columnFormatter";
import {
  getExportMaxConcurrentPerUser,
  getExportMaxRows,
  getExportMaxFileMb,
  exportMbToBytes,
  concurrencyCapMessage,
  rowCapMessage,
  sizeCapMessage,
  ExportCapError,
  RowCapError,
  SizeCapError,
} from "./exportCaps";

/** Phase 131: format "formatted" maps rows through the table's column display config (labels + buildFormatter) before csvLine; name is the user-supplied display name, sanitised by the route (Plan 131-04) and read back by exportJobAccess. */
export type ExportOptions = { format?: "raw" | "formatted"; compress?: boolean; name?: string };

export type FormatPlan = { labels: string[]; fns: (((v: unknown) => unknown) | null)[] };
/** null = raw fallback (no numeric tableId, e.g. dv-bound widget). Loaded once per run: a config edit mid-run is not applied (snapshot semantics). */
export function loadFormatPlan(widgetId: number, header: readonly string[]): FormatPlan | null {
  const tableId = (getWidget(widgetId)?.config as Record<string, unknown> | null | undefined)?.tableId;
  if (typeof tableId !== "number") return null;
  const byName = new Map(listColumnDisplayConfig(tableId).map((r) => [r.column_name, r]));
  return {
    labels: header.map((c) => { const l = byName.get(c)?.label; return typeof l === "string" && l !== "" ? l : c; }),
    fns: header.map((c) => {
      const spec = byName.get(c)?.format_spec as FormatSpec | null | undefined;
      if (spec == null || (spec as { kind?: unknown }).kind === "none") return null; // identity: skip the call entirely
      try { const f = buildFormatter(spec); return (v: unknown) => { try { return f(v); } catch { return v; } }; } catch { return null; }
    }),
  };
}

// Phase 130 D-13/D-14: counts bytes headed to disk (AFTER zip framing). Exact per chunk; exceeding errors the pipeline,
// which destroys every stage, so the existing catch deletes the .part file.
function byteCap(maxBytes: number, rowsNow: () => number): Transform {
  let n = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      n += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk), "utf8");
      if (n > maxBytes) return cb(new SizeCapError(maxBytes, rowsNow()));
      cb(null, chunk);
    },
  });
}

/**
 * Streams a header plus batches of rows as CSV into `sink`. Records are joined
 * by "\r\n" (no trailing CRLF, no BOM) so bytes equal web rowsToCsv. Backpressure
 * comes from stream.pipeline over a lazily-pulled async generator.
 */
export async function writeCsv(
  batches: AsyncIterable<readonly (readonly unknown[])[]>,
  header: readonly string[],
  sink: NodeJS.WritableStream,
  opts: { signal?: AbortSignal; zip?: ZipEntryOptions; maxBytes?: number; onBatch?: (rowsSoFar: number) => void } = {},
): Promise<number> {
  let rowsSoFar = 0;
  async function* gen(): AsyncGenerator<string> {
    yield csvLine(header);
    for await (const batch of batches) {
      let chunk = "";
      for (const row of batch) chunk += "\r\n" + csvLine(row);
      rowsSoFar += batch.length;
      yield chunk;
      opts.onBatch?.(rowsSoFar);
    }
  }
  const src = Readable.from(gen());
  await pipeline(
    src,
    ...(opts.zip ? createZipEntryStages(opts.zip) : []),
    ...(opts.maxBytes ? [byteCap(opts.maxBytes, () => rowsSoFar)] : []),
    sink,
    { signal: opts.signal },
  );
  return rowsSoFar;
}

// ---- Runner config + session-derived principal ----

export const EXPORT_ROUTE = "EXPORT job";
export const EXPORT_SESSION_ENDED_MESSAGE = "Export stopped: your session ended. Sign in and start it again."; // D-16 verbatim

export class SessionEndedError extends Error {
  constructor() {
    super("session ended");
    this.name = "SessionEndedError";
  }
}

export const getExportDir = (): string => process.env.EXPORT_DIR || path.join(process.cwd(), "data", "exports");

const warnedExportEnv = new Set<string>();
export const getExportViewTtlMinutes = (): number => {
  const def = 60;
  const raw = process.env.EXPORT_VIEW_TTL_MINUTES;
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    const key = `EXPORT_VIEW_TTL_MINUTES=${raw}`;
    if (!warnedExportEnv.has(key)) {
      warnedExportEnv.add(key);
      console.warn(
        `[export] EXPORT_VIEW_TTL_MINUTES must be a positive integer (got: ${JSON.stringify(raw)}); falling back to default ${def}`,
      );
    }
    return def;
  }
  return n;
};

export const getExportBatchSize = (): number => {
  const { maxRowsPerQuery, maxRecordsPerCall } = getRowLimitConfig();
  return Math.min(maxRowsPerQuery, maxRecordsPerCall);
};

/** Fresh, uncached principal mapped exactly like auth.ts. Never extends the session. */
export const principalForSession = (sid: string): KineticaPrincipal => {
  const session = getSession(sid);
  if (!session) throw new SessionEndedError();
  if (session.kineticaUrl !== process.env.KINETICA_URL) {
    deleteSession(sid);
    throw new SessionEndedError();
  }
  return {
    user: {
      sub: session.username,
      sid: session.sid,
      credentialType: session.credentialType,
      creds: {
        username: session.username,
        password: session.credentialType === "password" ? session.secret : "",
        token: session.credentialType === "oidc" ? session.secret : "",
      },
    },
    requestId: randomUUID(),
  } as KineticaPrincipal;
};

// ---- Run loop ----

class RowMismatchError extends Error {
  constructor(
    public written: number,
    public total: number,
  ) {
    super(`row mismatch ${written}/${total}`);
  }
}

/** Snapshot (CREATE MATERIALIZED VIEW) failed for a non-auth reason, e.g. missing DDL permission. */
class SnapshotError extends Error {
  constructor(cause: Error) {
    super(
      `Could not create the export snapshot: ${cause.message}. ` +
        "Your Kinetica account may not be allowed to create materialized views.",
    );
    this.name = "SnapshotError";
  }
}

const abortError = (): Error => {
  const e = new Error("The operation was aborted");
  e.name = "AbortError";
  return e;
};

const controllers = new Map<string, AbortController>();
const runs = new Map<string, Promise<void>>();

const transpose = (r: unknown): unknown[][] => {
  const o = (r ?? {}) as Record<string, unknown>;
  const headers = Array.isArray(o.column_headers) ? (o.column_headers as unknown[]) : [];
  const cols = headers.map((_, j) => (Array.isArray(o[`column_${j + 1}`]) ? (o[`column_${j + 1}`] as unknown[]) : []));
  const n = cols.length ? cols[0].length : 0;
  const rows: unknown[][] = [];
  for (let i = 0; i < n; i++) rows.push(cols.map((c) => c[i]));
  return rows;
};

// Phase 129: also used by DELETE /api/exports/:id
export const exportFilePaths = (jobId: string): string[] => {
  const base = path.join(getExportDir(), jobId);
  return [`${base}.csv`, `${base}.csv.gz`, `${base}.csv.part`, `${base}.csv.gz.part`];
};

export function startExport(args: {
  spec: ExportSpec;
  sid: string;
  username: string;
  options?: ExportOptions;
}): { jobId: string } {
  const { spec, sid, username } = args;
  const options = args.options ?? {};
  const jobId = randomUUID();
  const plan = buildExportPlan({
    spec,
    widget: getWidget(spec.widgetId),
    username,
    jobId,
    getTable,
    getDashboardDynamicView,
  });
  // Phase 130 D-09/D-10: per-user concurrency cap. MUST stay in this synchronous segment (no await between
  // the count and insertExportJob): better-sqlite3 + single-threaded JS make check-then-insert atomic.
  // A run whose controller is already aborted is being cancelled: it still reads "running" until its in-flight
  // Kinetica call returns, but it no longer holds a slot, so Cancel frees the slot at once.
  const activeNow = listActiveExportJobIdsForUser(username).filter((id) => !controllers.get(id)?.signal.aborted).length;
  if (activeNow >= getExportMaxConcurrentPerUser()) throw new ExportCapError(concurrencyCapMessage(activeNow));
  insertExportJob({
    id: jobId,
    username,
    sid,
    dashboardId: plan.dashboardId,
    widgetId: plan.widgetId,
    specJson: JSON.stringify(spec),
    optionsJson: JSON.stringify(options),
  });
  const ac = new AbortController();
  controllers.set(jobId, ac);
  const p = run(jobId, plan, sid, options, ac.signal)
    .catch((e) => console.error("[export] unexpected", jobId, e))
    .finally(() => {
      controllers.delete(jobId);
      runs.delete(jobId);
    });
  runs.set(jobId, p);
  return { jobId };
}

export function cancelExport(jobId: string): boolean {
  const ac = controllers.get(jobId);
  if (ac) {
    ac.abort();
    return true;
  }
  const job = getExportJob(jobId);
  if (job && (job.status === "queued" || job.status === "running")) {
    // No live run (e.g. after a restart): finalize directly and clear any partial file.
    finalizeExportJob(jobId, "cancelled", { errorMessage: "Export cancelled." });
    for (const f of exportFilePaths(jobId)) fs.rmSync(f, { force: true });
    return true;
  }
  return false;
}

/** Test hook: resolves when the job's run (including cleanup) has finished. */
export const __exportRunForTest = (jobId: string): Promise<void> | undefined => runs.get(jobId);

/** Phase 130: true while this process is running the job (boot reconcile must never fail a live run). */
export const isExportRunLive = (jobId: string): boolean => controllers.has(jobId) || runs.has(jobId);

async function run(
  jobId: string,
  plan: ExportPlan,
  sid: string,
  options: ExportOptions,
  signal: AbortSignal,
): Promise<void> {
  if (!markExportJobRunning(jobId)) return; // cancelled before start
  const dir = getExportDir();
  const finalPath = path.join(dir, jobId + (options.compress ? ".zip" : ".csv"));
  const partPath = finalPath + ".part";
  // Phase 130: hoisted so the catch formats with the same values the run enforced.
  const rowCap = getExportMaxRows();
  const capMb = getExportMaxFileMb();
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Principal is built inside each call and not stored anywhere (EXPRT-V126-16).
    const sql = (statement: string, extra?: Record<string, unknown>, op: "SQL" | "MATERIALIZE" = "SQL") => {
      if (signal.aborted) throw abortError();
      return kineticaSql(principalForSession(sid), statement, { route: EXPORT_ROUTE, op, extra });
    };

    if (signal.aborted) throw abortError();
    try {
      await createOrReplaceMaterialized({
        req: principalForSession(sid),
        view: plan.snapshotView,
        sqlBody: plan.snapshotBody,
        ttl: getExportViewTtlMinutes(),
        route: EXPORT_ROUTE,
        op: "MATERIALIZE",
      });
    } catch (e) {
      // Missing CREATE MATERIALIZED VIEW permission etc.: surface as a readable kinetica_error, never a hang.
      if (e instanceof KineticaPermissionError || e instanceof KineticaUpstreamError) throw new SnapshotError(e);
      throw e;
    }

    const countRes = (await sql(plan.countSql)) as Record<string, unknown>;
    const total = Number((countRes.column_1 as unknown[] | undefined)?.[0]);
    if (!Number.isFinite(total)) throw new KineticaUpstreamError("Kinetica returned no row count for the snapshot");
    setExportJobTotalRows(jobId, total);
    // Phase 130 D-12: refuse before any batch is fetched or any file is created.
    if (rowCap !== null && total > rowCap) throw new RowCapError(total, rowCap);

    let header: string[] = plan.columns;
    if (!header.length) {
      const probe = (await sql(buildHeaderProbeSql(plan), { limit: 1 })) as Record<string, unknown>;
      header = Array.isArray(probe.column_headers) ? (probe.column_headers as string[]) : [];
    }

    const fmt = options.format === "formatted" ? loadFormatPlan(plan.widgetId, header) : null;
    const outHeader = fmt ? fmt.labels : header;

    async function* batches(): AsyncGenerator<unknown[][]> {
      let offset = 0;
      for (;;) {
        if (signal.aborted) throw abortError();
        const { sql: s, extra } = buildBatchRequest(plan, header, offset, getExportBatchSize(), getExportViewTtlMinutes());
        const r = (await sql(s, extra)) as Record<string, unknown>;
        const rows = transpose(r);
        offset += rows.length; // advance by rows RECEIVED, never the requested limit
        yield fmt ? rows.map((row) => row.map((v, j) => (fmt.fns[j] ? fmt.fns[j]!(v) : v))) : rows;
        if (r.has_more_records !== true || rows.length === 0) break; // a short page alone never ends the loop
      }
    }

    // Don't open a .part for a run that is already cancelled (pipeline() would still clean it up; this just skips the work).
    if (signal.aborted) throw abortError();
    const written = await writeCsv(batches(), outHeader, fs.createWriteStream(partPath, { mode: 0o600 }), {
      signal,
      zip: options.compress ? { entryName: exportDownloadBase(options.name, jobId, getExportJob(jobId)?.createdAt ?? new Date().toISOString()) + ".csv" } : undefined,
      maxBytes: capMb === null ? undefined : exportMbToBytes(capMb),
      onBatch: (n) => updateExportJobProgress(jobId, n),
    });
    if (written !== total) throw new RowMismatchError(written, total);
    if (signal.aborted) throw abortError();
    fs.renameSync(partPath, finalPath);
    const bytes = fs.statSync(finalPath).size;
    if (!finalizeExportJob(jobId, "complete", { rowsWritten: written, filePath: finalPath, fileBytes: bytes })) {
      fs.rmSync(finalPath, { force: true });
    }
  } catch (err) {
    fs.rmSync(partPath, { force: true });
    fs.rmSync(finalPath, { force: true });
    const rowsWritten = getExportJob(jobId)?.rowsWritten ?? 0;
    const e = err as Error;
    if (signal.aborted || e?.name === "AbortError") {
      finalizeExportJob(jobId, "cancelled", { rowsWritten, errorMessage: "Export cancelled." });
    } else if (err instanceof RowCapError) {
      finalizeExportJob(jobId, "failed", { rowsWritten: 0, errorCode: "row_cap", errorMessage: rowCapMessage(err.total, err.cap) });
    } else if (err instanceof SizeCapError) {
      // finalizeExportJob is write-once: a user cancel that raced to terminal first stays authoritative.
      finalizeExportJob(jobId, "failed", {
        rowsWritten: err.rowsAtCut,
        errorCode: "size_cap",
        errorMessage: sizeCapMessage({
          capMb: capMb!,
          rowsAtCut: err.rowsAtCut,
          totalRows: getExportJob(jobId)?.totalRows ?? null,
          compressed: options.compress === true,
        }),
      });
    } else if (err instanceof SessionEndedError || err instanceof KineticaAuthError) {
      finalizeExportJob(jobId, "session_expired", {
        rowsWritten,
        errorCode: "session_expired",
        errorMessage: EXPORT_SESSION_ENDED_MESSAGE,
      });
    } else if (err instanceof RowMismatchError) {
      finalizeExportJob(jobId, "failed", {
        rowsWritten,
        errorCode: "row_mismatch",
        errorMessage: `Export wrote ${err.written} rows but the snapshot has ${err.total}; the file was discarded.`,
      });
    } else if (
      err instanceof SnapshotError ||
      err instanceof KineticaPermissionError ||
      err instanceof KineticaUpstreamError
    ) {
      finalizeExportJob(jobId, "failed", { rowsWritten, errorCode: "kinetica_error", errorMessage: e.message });
    } else {
      console.error("[export] internal error", jobId, err);
      finalizeExportJob(jobId, "failed", {
        rowsWritten,
        errorCode: "internal_error",
        errorMessage: "Export failed unexpectedly.",
      });
    }
  } finally {
    // Best-effort Kinetica cleanup; the snapshot TTL is the crash backstop. Skipped on a dead session.
    for (const name of [plan.pagingTable, plan.snapshotView].filter((n): n is string => Boolean(n))) {
      try {
        await kineticaSql(principalForSession(sid), `DROP TABLE IF EXISTS ${name}`, {
          route: EXPORT_ROUTE,
          op: "MATERIALIZE",
        });
      } catch (e) {
        console.warn(`[export] cleanup of ${name} skipped (${(e as Error).name}); its TTL will expire it`);
      }
    }
  }
}
