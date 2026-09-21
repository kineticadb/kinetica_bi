/**
 * routes.schema-check.spec.ts — Phase 122 Plan 04 (SSYNC-V125-02/-03/-04/-05)
 *
 * Integration supertests for GET /api/tables/:id/schema-check:
 *   - The three 200 outcomes (diff / baseline_required / table_missing)
 *   - The 502 error path (unreachable Kinetica, and a present-but-unparseable body)
 *   - Exactly ONE Kinetica call, targeting /show/table, carrying
 *     options.no_error_if_not_exists = "true"
 *   - The five app config tables (tables, widgets, dashboard_layers,
 *     custom_metrics, column_display_config) are byte-identical after a check,
 *     across all three 200 outcomes
 *   - The datasets:manage permission gate (analyst -> 403)
 *
 * SET-BASED gate note (CLAUDE.md "Test gates"): server vitest is set-based.
 * Do NOT assert a fixed server-wide pass count anywhere in this file.
 *
 * The `columns_fingerprint` writes in this file are raw test SQL
 * (`db.prepare("UPDATE tables SET columns_fingerprint = ? WHERE id = ?")...`)
 * precisely because Phase 122 intentionally ships NO writer for this column —
 * Phase 125's apply step owns it (see 122-02-SUMMARY.md).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";
import {
  db,
  createTable,
  createDashboard,
  createWidget,
  createDashboardLayer,
  upsertColumnDisplayConfig,
  createCustomMetric,
} from "../src/db";
import { createSession } from "../src/sessionStore";
import jwt from "jsonwebtoken";

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;

/**
 * Seeds an analyst session. The user gets NO user_roles row -> analyst fallback.
 * Analyst has dashboards:view only -- no datasets:manage.
 * Mirrors the seedAnalystSession idiom from routes.column-display-config.spec.ts.
 */
const seedAnalystSession = (username: string): { cookie: string } => {
  const sid = createSession({ username, secret: "analyst-pw", kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};

// Phase 122 ships no writer for tables.columns_fingerprint -- this raw SQL IS the
// intended way a test establishes a precise baseline (see file header).
const setStoredFingerprint = (
  tableId: number,
  columns: Record<string, { base: string; refinements: string[] }>
): void => {
  db.prepare("UPDATE tables SET columns_fingerprint = ? WHERE id = ?").run(
    JSON.stringify({ v: 1, columns }),
    tableId
  );
};

// The REST envelope kineticaShowTable decodes: `data_str` is JSON-parsed to get
// the show_table_response object (no json_encoded_response nesting, unlike /execute/sql).
const showTableEnvelope = (decoded: Record<string, unknown>) => ({
  status: "OK",
  data_str: JSON.stringify(decoded),
});

const mockShowTableOk = (decoded: Record<string, unknown>) =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify(showTableEnvelope(decoded)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );

// ─── Fixture bodies ────────────────────────────────────────────────────────────

// "changed" fixture -- the operator's own varchar8 -> varchar32 case, end to end.
// stored: vendor_id string(char4), payment_type string(char16), passenger_count
// int(int8), dropped_col string (bare). live: vendor_id widened to char32,
// passenger_count re-based to double, dropped_col absent, new surcharge float.
const CHANGED_STORED = {
  vendor_id: { base: "string", refinements: ["char4"] },
  payment_type: { base: "string", refinements: ["char16"] },
  passenger_count: { base: "int", refinements: ["int8"] },
  dropped_col: { base: "string", refinements: [] as string[] },
};

const CHANGED_LIVE_BODY = {
  table_names: ["demo.nyctaxi"],
  type_schemas: [
    JSON.stringify({
      type: "record",
      name: "type_name",
      fields: [
        { name: "vendor_id", type: "string" },
        { name: "payment_type", type: "string" },
        { name: "passenger_count", type: "double" },
        { name: "surcharge", type: "float" },
      ],
    }),
  ],
  properties: [
    {
      vendor_id: ["data", "char32"],
      payment_type: ["data", "char16"],
      passenger_count: ["data"],
      surcharge: ["data"],
    },
  ],
};

// "unchanged" fixture -- stored and live agree on every column.
const STABLE_MAP = {
  vendor_id: { base: "string", refinements: ["char4"] },
  payment_type: { base: "string", refinements: ["char16"] },
};

const STABLE_LIVE_BODY = {
  table_names: ["demo.nyctaxi"],
  type_schemas: [
    JSON.stringify({
      type: "record",
      name: "type_name",
      fields: [
        { name: "vendor_id", type: "string" },
        { name: "payment_type", type: "string" },
      ],
    }),
  ],
  properties: [
    {
      vendor_id: ["data", "char4"],
      payment_type: ["data", "char16"],
    },
  ],
};

// Real body -- 122-SPIKE-NOTES.md Q5, the no_error_if_not_exists: true probe.
const MISSING_BODY = {
  table_name: "demo.nyctaxi",
  table_names: [] as string[],
  type_schemas: [] as unknown[],
  properties: [] as unknown[],
  info: { WARNING_0: "Could not find the table: '…' (TM/SMc:1046)" },
};

// Present but unparseable -- table_names says present, type_schemas/properties are junk.
const UNPARSEABLE_PRESENT_BODY = {
  table_names: ["demo.nyctaxi"],
  type_schemas: ["not json"],
  properties: [{}],
};

// Structurally malformed -- NO table_names array at all. schemaFingerprint.ts's
// tablePresence() classifies this as "unreadable", a THIRD state distinct from
// "missing" (an explicit empty array). M9 (mutation probes table) collapses
// "unreadable" into "missing" in the route's caller; this fixture is the only
// one in this file that can catch that collapse, since the "unreachable
// Kinetica" test above is a network-level fetch rejection that never reaches
// tablePresence() at all.
const NO_TABLE_NAMES_BODY = {
  some_other_field: "not a show/table response",
};

// Rename fixture -- stored has customer_id, live has customer_identifier instead
// (same type). No per-column identity exists (122-SPIKE-NOTES.md Q3): this must
// report as one removal plus one addition, never a pairing.
const RENAME_STORED = {
  customer_id: { base: "string", refinements: ["char8"] },
};

const RENAME_LIVE_BODY = {
  table_names: ["demo.nyctaxi"],
  type_schemas: [
    JSON.stringify({
      type: "record",
      name: "type_name",
      fields: [{ name: "customer_identifier", type: "string" }],
    }),
  ],
  properties: [
    {
      customer_identifier: ["data", "char8"],
    },
  ],
};

// ─── Cleanup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM tables");
  db.exec("DELETE FROM column_display_config");
});

describe("GET /api/tables/:id/schema-check", () => {
  it("changed table: 200 with added, removed and retyped groups, retypes naming both types", async () => {
    const table = createTable({ name: "nyctaxi", schema: "demo" });
    setStoredFingerprint(table.id, CHANGED_STORED);
    vi.stubGlobal("fetch", mockShowTableOk(CHANGED_LIVE_BODY));

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    const res = await app.get(`/api/tables/${table.id}/schema-check`).set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("diff");
    expect(res.body.hasChanges).toBe(true);
    expect(res.body.added.map((c: { column: string }) => c.column)).toEqual(["surcharge"]);
    expect(res.body.removed.map((c: { column: string }) => c.column)).toEqual(["dropped_col"]);
    expect(res.body.retyped.map((c: { column: string }) => c.column)).toEqual([
      "passenger_count",
      "vendor_id",
    ]);
    const vendorRetype = res.body.retyped.find((c: { column: string }) => c.column === "vendor_id");
    expect(vendorRetype.storedType).toBe("string(char4)");
    expect(vendorRetype.liveType).toBe("string(char32)");
  });

  it("unchanged table: 200 outcome 'diff' with hasChanges false and three empty groups", async () => {
    const table = createTable({ name: "nyctaxi", schema: "demo" });
    setStoredFingerprint(table.id, STABLE_MAP);
    vi.stubGlobal("fetch", mockShowTableOk(STABLE_LIVE_BODY));

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    const res = await app.get(`/api/tables/${table.id}/schema-check`).set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("diff");
    expect(res.body.hasChanges).toBe(false);
    expect(res.body.added).toEqual([]);
    expect(res.body.removed).toEqual([]);
    expect(res.body.retyped).toEqual([]);
  });

  it("missing table: 200 outcome 'table_missing' with no added/removed/retyped keys", async () => {
    const table = createTable({ name: "nyctaxi", schema: "demo" });
    setStoredFingerprint(table.id, STABLE_MAP);
    vi.stubGlobal("fetch", mockShowTableOk(MISSING_BODY));

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    const res = await app.get(`/api/tables/${table.id}/schema-check`).set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("table_missing");
    expect("added" in res.body).toBe(false);
    expect("removed" in res.body).toBe(false);
    expect("retyped" in res.body).toBe(false);
  });

  it("missing table: the message covers a dropped table AND one renamed in Kinetica", async () => {
    const table = createTable({ name: "nyctaxi", schema: "demo" });
    vi.stubGlobal("fetch", mockShowTableOk(MISSING_BODY));

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    const res = await app.get(`/api/tables/${table.id}/schema-check`).set("Cookie", cookie);

    expect(res.status).toBe(200);
    const message = String(res.body.message).toLowerCase();
    expect(message).toContain("dropped");
    expect(message).toContain("renamed");
  });

  it("unreachable Kinetica: 502 and the body has no outcome field", async () => {
    const table = createTable({ name: "nyctaxi", schema: "demo" });
    setStoredFingerprint(table.id, STABLE_MAP);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection reset")));

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    const res = await app.get(`/api/tables/${table.id}/schema-check`).set("Cookie", cookie);

    expect(res.status).toBe(502);
    expect(res.body.outcome).toBeUndefined();
  });

  it("unparseable /show/table body for a table that IS present: 502, never a diff", async () => {
    const table = createTable({ name: "nyctaxi", schema: "demo" });
    setStoredFingerprint(table.id, STABLE_MAP);
    vi.stubGlobal("fetch", mockShowTableOk(UNPARSEABLE_PRESENT_BODY));

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    const res = await app.get(`/api/tables/${table.id}/schema-check`).set("Cookie", cookie);

    expect(res.status).toBe(502);
    expect(res.body.outcome).toBeUndefined();
  });

  it("unreadable /show/table body (no table_names array at all): 502, never table_missing or a diff", async () => {
    const table = createTable({ name: "nyctaxi", schema: "demo" });
    setStoredFingerprint(table.id, STABLE_MAP);
    vi.stubGlobal("fetch", mockShowTableOk(NO_TABLE_NAMES_BODY));

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    const res = await app.get(`/api/tables/${table.id}/schema-check`).set("Cookie", cookie);

    expect(res.status).toBe(502);
    expect(res.body.outcome).toBeUndefined();
  });

  it("old-format table (columns_fingerprint NULL): 200 outcome 'baseline_required', not a diff", async () => {
    // NEVER call setStoredFingerprint -- columns_fingerprint stays NULL, the
    // pre-v1.25 "no precise baseline yet" state.
    const table = createTable({ name: "nyctaxi", schema: "demo" });
    vi.stubGlobal("fetch", mockShowTableOk(STABLE_LIVE_BODY));

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    const res = await app.get(`/api/tables/${table.id}/schema-check`).set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("baseline_required");
    expect(res.body.live.vendor_id).toEqual({ base: "string", refinements: ["char4"] });
    expect("added" in res.body).toBe(false);
    expect("removed" in res.body).toBe(false);
    expect("retyped" in res.body).toBe(false);
  });

  it("renamed column via the route: one removal plus one addition, and the response JSON carries no rename token", async () => {
    const table = createTable({ name: "nyctaxi", schema: "demo" });
    setStoredFingerprint(table.id, RENAME_STORED);
    vi.stubGlobal("fetch", mockShowTableOk(RENAME_LIVE_BODY));

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    const res = await app.get(`/api/tables/${table.id}/schema-check`).set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("diff");
    expect(res.body.added.map((c: { column: string }) => c.column)).toEqual(["customer_identifier"]);
    expect(res.body.removed.map((c: { column: string }) => c.column)).toEqual(["customer_id"]);
    expect(res.body.retyped).toEqual([]);

    const json = JSON.stringify(res.body).toLowerCase();
    for (const token of ["renam", "similar", "score", "ordinal", "probabl", "likely", "match"]) {
      expect(json).not.toContain(token);
    }
  });

  it("the check makes exactly one Kinetica call and its URL contains /show/table", async () => {
    const table = createTable({ name: "nyctaxi", schema: "demo" });
    setStoredFingerprint(table.id, STABLE_MAP);
    const fetchMock = mockShowTableOk(STABLE_LIVE_BODY);
    vi.stubGlobal("fetch", fetchMock);

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    const res = await app.get(`/api/tables/${table.id}/schema-check`).set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/show/table");
  });

  it("the /show/table request body carries options.no_error_if_not_exists = 'true'", async () => {
    const table = createTable({ name: "nyctaxi", schema: "demo" });
    setStoredFingerprint(table.id, STABLE_MAP);
    const fetchMock = mockShowTableOk(STABLE_LIVE_BODY);
    vi.stubGlobal("fetch", fetchMock);

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    await app.get(`/api/tables/${table.id}/schema-check`).set("Cookie", cookie);

    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse((init as { body: string }).body);
    expect(sentBody.options.no_error_if_not_exists).toBe("true");
  });

  it("a check leaves tables, widgets, dashboard_layers, custom_metrics and column_display_config byte-identical", async () => {
    const dashboard = createDashboard("Schema Check Dash", "byte-identical proof");
    const table = createTable({ name: "nyctaxi", schema: "demo" });
    setStoredFingerprint(table.id, STABLE_MAP);
    const noBaselineTable = createTable({ name: "orders", schema: "demo" });
    createWidget(dashboard.id, { title: "W1", type: "chart", position: 0, config: {} });
    createDashboardLayer(dashboard.id, { table_id: table.id });
    createCustomMetric(table.id, "Total", "SUM(x)", null);
    upsertColumnDisplayConfig(table.id, "vendor_id", "Vendor", null);

    const SNAPSHOT_TABLES = [
      "tables",
      "widgets",
      "dashboard_layers",
      "custom_metrics",
      "column_display_config",
    ];
    const snapshot = () => {
      const out: Record<string, unknown[]> = {};
      for (const t of SNAPSHOT_TABLES) {
        out[t] = db.prepare(`SELECT * FROM ${t}`).all();
      }
      return out;
    };

    const before = snapshot();
    // Verify the seeding actually took before relying on it -- a seed that
    // silently failed an FK constraint would restore exactly the vacuous
    // (empty-vs-empty) comparison this instruction exists to prevent.
    for (const t of SNAPSHOT_TABLES) {
      expect(before[t].length).toBeGreaterThan(0);
    }

    const { cookie } = createAdminSession();
    const app = await buildTestApp();

    // diff outcome
    vi.stubGlobal("fetch", mockShowTableOk(STABLE_LIVE_BODY));
    const diffRes = await app.get(`/api/tables/${table.id}/schema-check`).set("Cookie", cookie);
    expect(diffRes.status).toBe(200);
    expect(diffRes.body.outcome).toBe("diff");

    // baseline_required outcome
    vi.stubGlobal("fetch", mockShowTableOk(STABLE_LIVE_BODY));
    const baselineRes = await app
      .get(`/api/tables/${noBaselineTable.id}/schema-check`)
      .set("Cookie", cookie);
    expect(baselineRes.status).toBe(200);
    expect(baselineRes.body.outcome).toBe("baseline_required");

    // table_missing outcome
    vi.stubGlobal("fetch", mockShowTableOk(MISSING_BODY));
    const missingRes = await app.get(`/api/tables/${table.id}/schema-check`).set("Cookie", cookie);
    expect(missingRes.status).toBe(200);
    expect(missingRes.body.outcome).toBe("table_missing");

    const after = snapshot();
    expect(after).toEqual(before);
  });

  it("unknown table id: 404 Table not found.", async () => {
    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    const res = await app.get("/api/tables/999999/schema-check").set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Table not found." });
  });

  it("analyst: 403 PERMISSION_DENIED (datasets:manage gate)", async () => {
    const table = createTable({ name: "nyctaxi", schema: "demo" });
    setStoredFingerprint(table.id, STABLE_MAP);
    vi.stubGlobal("fetch", mockShowTableOk(STABLE_LIVE_BODY));

    const { cookie } = seedAnalystSession("schema-check-analyst");
    const app = await buildTestApp();
    const res = await app.get(`/api/tables/${table.id}/schema-check`).set("Cookie", cookie);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });
});
