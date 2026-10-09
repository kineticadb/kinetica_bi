/**
 * Phase 126 Plan 01 (SSYNC-V125-01 / SSYNC-V125-18): unit tests for the four schema-sync
 * route callers in `api/client.ts` — checkTableSchema, applyTableSchema,
 * listTableSyncHistory and deleteTableSyncHistoryEntry.
 *
 * Coverage, by test-id prefix:
 *   CLIENT-check-*  : GET /api/tables/:id/schema-check — URL shape and BARE-body parsing,
 *                     including the load-bearing ABSENCE of the optional `impact` key.
 *   CLIENT-apply-*  : POST /api/tables/:id/schema-apply — request body shape and the
 *                     preserved 400 / 403 error behaviour.
 *   CLIENT-409-*    : the same POST's HTTP 409 REFUSAL, which must RESOLVE to the server's
 *                     own `stale` / `table_missing` outcome with its operator-facing
 *                     `message` byte-intact — never be swallowed by throwForStatus(), which
 *                     reads only an `{ error }` key (client.ts:97-118) that a 409 body lacks.
 *   CLIENT-history-*: GET /api/tables/:id/sync-history — `cap` and `droppedCount` come from
 *                     the response and are never hardcoded.
 *   CLIENT-204-*    : DELETE /api/tables/:id/sync-history/:entryId — a 204 carries NO body,
 *                     so the caller must never call .json() on it.
 *
 * All fixture table and column names are neutral synthetic placeholders.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkTableSchema,
  applyTableSchema,
  listTableSyncHistory,
  deleteTableSyncHistoryEntry,
  PermissionError,
} from "./client";
import type { ColumnFingerprintMap } from "./client";

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * A minimal Response-shaped stub. `clone()` returns itself so the 401/403 body-peek in
 * apiFetch and the body-read in throwForStatus both work. `json` is overridable so the
 * 204 case can supply one that REJECTS — the only way to prove the caller never calls it.
 */
function makeResponseStub(
  body: unknown,
  {
    ok = true,
    status = 200,
    json,
  }: { ok?: boolean; status?: number; json?: () => Promise<unknown> } = {},
) {
  const stub = {
    ok,
    status,
    json: json ?? (() => Promise.resolve(body)),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: { get: () => null },
    clone: (): unknown => stub,
  };
  return stub;
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const LIVE: ColumnFingerprintMap = { col_a: { base: "int", refinements: [] } };

// ─── CLIENT-check- : GET schema-check ───────────────────────────────────────

describe("checkTableSchema", () => {
  it("CLIENT-check-url: fetches /api/tables/:id/schema-check", async () => {
    fetchSpy.mockResolvedValue(
      makeResponseStub({ outcome: "table_missing", table: "s.t", message: "gone" }),
    );
    await checkTableSchema(7);
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(String(url)).toMatch(/\/api\/tables\/7\/schema-check$/);
  });

  it("CLIENT-check-bare-body: resolves to the BARE response body, impact included", async () => {
    const body = {
      outcome: "diff",
      table: "s.t",
      hasChanges: true,
      added: [],
      removed: [],
      retyped: [],
      live: { col_a: { base: "int", refinements: [] } },
      impact: {
        v: 1,
        table: "s.t",
        tableId: 7,
        outcome: "changes",
        sections: [
          { severity: "breaking", columns: [] },
          { severity: "changed", columns: [] },
          { severity: "harmless", columns: [] },
        ],
        advisorySummary: [],
        knownGaps: [],
      },
    };
    fetchSpy.mockResolvedValue(makeResponseStub(body));
    const result = await checkTableSchema(7);
    expect(result).toEqual(body);
    // The route returns no { data } envelope — reaching for one would leave this undefined.
    expect(result.impact).toBeDefined();
  });

  it("CLIENT-check-impact-absent: an absent `impact` key stays absent", async () => {
    const body = {
      outcome: "baseline_required",
      table: "s.t",
      message: "A baseline is required before changes can be reported.",
      live: { col_a: { base: "int", refinements: [] } },
    };
    fetchSpy.mockResolvedValue(makeResponseStub(body));
    const result = await checkTableSchema(7);
    // PRESENCE of `impact` distinguishes "no findings" from "not yet run" — the caller must
    // not default it into existence.
    expect("impact" in result).toBe(false);
    expect(result).toEqual(body);
  });
});

// ─── CLIENT-apply- / CLIENT-409- : POST schema-apply ────────────────────────

describe("applyTableSchema", () => {
  it("CLIENT-apply-body: POSTs { live } as JSON", async () => {
    fetchSpy.mockResolvedValue(
      makeResponseStub({ outcome: "no_changes", table: "s.t", tableId: 7, message: "ok" }),
    );
    await applyTableSchema(7, LIVE);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/api\/tables\/7\/schema-apply$/);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ live: LIVE });
  });

  it("CLIENT-409-stale: a 409 `stale` RESOLVES with its message byte-intact", async () => {
    const message =
      "The table changed again while you were reviewing. Re-run the check and review the new report before applying.";
    const body = { outcome: "stale", table: "s.t", tableId: 7, message };
    fetchSpy.mockResolvedValue(makeResponseStub(body, { ok: false, status: 409 }));
    await expect(applyTableSchema(7, LIVE)).resolves.toEqual(body);
    const result = await applyTableSchema(7, LIVE);
    expect(result.message).toBe(message);
  });

  it("CLIENT-409-missing: a 409 `table_missing` RESOLVES too", async () => {
    const body = {
      outcome: "table_missing",
      table: "s.t",
      tableId: 7,
      message: "The table no longer exists in the data source.",
    };
    fetchSpy.mockResolvedValue(makeResponseStub(body, { ok: false, status: 409 }));
    await expect(applyTableSchema(7, LIVE)).resolves.toEqual(body);
  });

  it("CLIENT-apply-403: a 403 still rejects with PermissionError", async () => {
    fetchSpy.mockResolvedValue(
      makeResponseStub({ error: "nope", code: "PERMISSION_DENIED" }, { ok: false, status: 403 }),
    );
    await expect(applyTableSchema(7, LIVE)).rejects.toBeInstanceOf(PermissionError);
  });

  it("CLIENT-apply-400: a 400 rejects with the server's error string", async () => {
    fetchSpy.mockResolvedValue(
      makeResponseStub({ error: "Body must include `live` as a non-empty object" }, {
        ok: false,
        status: 400,
      }),
    );
    await expect(applyTableSchema(7, LIVE)).rejects.toThrow(
      "Body must include `live` as a non-empty object",
    );
  });
});

// ─── CLIENT-history- : GET sync-history ─────────────────────────────────────

describe("listTableSyncHistory", () => {
  it("CLIENT-history-shape: resolves to the bare body, cap read from the response", async () => {
    const body = {
      entries: [
        {
          id: 41,
          table_id: 7,
          ts: "2026-09-28T14:02:00.000Z",
          actor: "operator_a",
          kind: "diff",
          changeset: { v: 1, added: [], removed: [], retyped: [] },
          report: null,
        },
      ],
      droppedCount: 3,
      lastDroppedTs: "2026-09-01T00:00:00.000Z",
      cap: 5,
    };
    fetchSpy.mockResolvedValue(makeResponseStub(body));
    const result = await listTableSyncHistory(7);
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(String(url)).toMatch(/\/api\/tables\/7\/sync-history$/);
    expect(result).toEqual(body);
    // Deliberately NOT the default of 20 — a hardcoded cap anywhere downstream is detectable.
    expect(result.cap).toBe(5);
  });
});

// ─── CLIENT-204- : DELETE one history entry ─────────────────────────────────

describe("deleteTableSyncHistoryEntry", () => {
  it("CLIENT-204-delete: a 204 resolves to undefined without reading a body", async () => {
    fetchSpy.mockResolvedValue(
      makeResponseStub(null, {
        ok: true,
        status: 204,
        json: () => Promise.reject(new Error("no body")),
      }),
    );
    await expect(deleteTableSyncHistoryEntry(7, 41)).resolves.toBeUndefined();
  });

  it("CLIENT-204-delete-url: DELETEs /api/tables/:id/sync-history/:entryId", async () => {
    fetchSpy.mockResolvedValue(
      makeResponseStub(null, {
        ok: true,
        status: 204,
        json: () => Promise.reject(new Error("no body")),
      }),
    );
    await deleteTableSyncHistoryEntry(7, 41);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/api\/tables\/7\/sync-history\/41$/);
    expect(init.method).toBe("DELETE");
  });
});
