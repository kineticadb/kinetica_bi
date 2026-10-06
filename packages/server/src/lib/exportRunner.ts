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
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { csvLine } from "./csvExport";
import { getRowLimitConfig, type KineticaPrincipal } from "../kinetica";
import { getSession, deleteSession } from "../sessionStore";

/**
 * Phase 131 seam: "formatted" plugs in as a row mapper applied before csvLine.
 */
export type ExportOptions = { format?: "raw"; gzip?: boolean };

/**
 * Streams a header plus batches of rows as CSV into `sink`. Records are joined
 * by "\r\n" (no trailing CRLF, no BOM) so bytes equal web rowsToCsv. Backpressure
 * comes from stream.pipeline over a lazily-pulled async generator.
 */
export async function writeCsv(
  batches: AsyncIterable<readonly (readonly unknown[])[]>,
  header: readonly string[],
  sink: NodeJS.WritableStream,
  opts: { signal?: AbortSignal; gzip?: boolean; onBatch?: (rowsSoFar: number) => void } = {},
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
  await pipeline(src, ...(opts.gzip ? [createGzip()] : []), sink, { signal: opts.signal });
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
