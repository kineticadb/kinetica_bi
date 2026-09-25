/**
 * routes.schema-apply.spec.ts — Phase 125 Plan 04 (SSYNC-V125-13/-14/-15/-16/-17)
 *
 * Integration supertests for the milestone's FIRST WRITE route and the two sync-history
 * routes that read what it wrote:
 *   - POST   /api/tables/:id/schema-apply
 *   - GET    /api/tables/:id/sync-history
 *   - DELETE /api/tables/:id/sync-history/:entryId
 *
 * Test-name prefixes, each chosen because it occurred ZERO times across tests/ before this
 * file existed (CLAUDE.md § "Writing verifiable acceptance criteria" — a grep anchor that
 * already matches proves nothing; `ROUTE-` was rejected for exactly that reason):
 *   GATE-     the datasets:manage AND dashboards:manage_access double gate
 *   ONECALL-  exactly one Kinetica call, and what happens when it comes back unreadable
 *   REFUSE-   the four things an apply must refuse WITHOUT writing
 *   PERSIST-  what a successful apply actually stores
 *   READ-     GET /sync-history
 *   DELETE-   DELETE /sync-history/:entryId
 *
 * SET-BASED gate note (CLAUDE.md "Test gates"): server vitest is set-based. Do NOT assert a
 * fixed server-wide pass count anywhere in this file.
 *
 * Fixtures are SYNTHETIC throughout (demo_schema.demo_table, col_a, col_b, col_ts, col_gone,
 * demo_operator) — no dataset-specific name appears on any line of this file.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";
import {
  db,
  createTable,
  createDashboard,
  createWidget,
  listTableSyncHistory,
} from "../src/db";
import { createSession } from "../src/sessionStore";
import { PERMISSIONS } from "../src/lib/permissions";
import jwt from "jsonwebtoken";

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;

// ─── Session + fixture helpers ─────────────────────────────────────────────────
//
// seedAnalystSession, seedDatasetsManageOnlySession, setStoredFingerprint and
// showTableEnvelope are COPIED from tests/routes.schema-check.spec.ts rather than imported.
// That file does not export them, and the copy is deliberate: the apply suite and the check
// suite must agree, line for line, about what a Kinetica /show/table envelope looks like and
// about what a precise stored baseline looks like. If the two ever disagree, the apply would
// be tested against a shape the check never produces.

/**
 * Seeds an analyst session. The user gets NO user_roles row -> analyst fallback.
 * Analyst has dashboards:view only -- no datasets:manage.
 */
const seedAnalystSession = (username: string): { cookie: string } => {
  const sid = createSession({ username, secret: "analyst-pw", kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};

/**
 * Seeds a session for a user holding EXACTLY datasets:manage -- no built-in role holds
 * datasets:manage without also holding dashboards:manage_access (designer and admin hold both;
 * analyst and user_admin hold neither), so this custom role is the only fixture that can
 * discriminate the SECOND half of these routes' AND-gate.
 */
const seedDatasetsManageOnlySession = (username: string): { cookie: string } => {
  db.prepare("INSERT INTO roles (name, description, built_in) VALUES ('datasets_manage_only', '', 0)").run();
  const role = db.prepare("SELECT id FROM roles WHERE name = 'datasets_manage_only'").get() as { id: number };
  db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)").run(
    role.id,
    PERMISSIONS.DATASETS_MANAGE
  );
  db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (lower(?), ?)").run(username, role.id);
  const sid = createSession({ username, secret: "datasets-manage-only-pw", kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};

/**
 * NEW in this file (no precedent in the check suite, which never needed a NON-admin caller
 * who can actually reach the handler): a session holding BOTH halves of the gate, under a
 * distinctive username. PERSIST-actor needs this -- asserting the recorded actor against the
 * admin fixture would compare it to APP_ADMIN_USERNAME, which several other code paths also
 * produce, so a distinctive name is what makes "the recorded actor is the SESSION's username"
 * a real claim.
 */
const seedSchemaSyncSession = (username: string): { cookie: string } => {
  db.prepare("INSERT INTO roles (name, description, built_in) VALUES ('schema_sync_operator', '', 0)").run();
  const role = db.prepare("SELECT id FROM roles WHERE name = 'schema_sync_operator'").get() as { id: number };
  for (const p of [PERMISSIONS.DATASETS_MANAGE, PERMISSIONS.DASHBOARDS_MANAGE_ACCESS]) {
    db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)").run(role.id, p);
  }
  db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (lower(?), ?)").run(username, role.id);
  const sid = createSession({ username, secret: "schema-sync-pw", kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};

// Phase 122 shipped no writer for tables.columns_fingerprint; Phase 125's apply is the first
// one. This raw SQL remains the intended way a TEST establishes a precise starting baseline,
// because using the apply route to set up the apply route's own fixtures would be circular.
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

/**
 * DIVERGES from the check suite's mockShowTableOk, deliberately: that one uses
 * `mockResolvedValue(new Response(...))`, which hands out the SAME Response instance every
 * call. A Response body can be consumed only once, so a second call would throw. PERSIST-diff
 * round-trips through apply AND then schema-check on one mock, so this file builds a FRESH
 * Response per call.
 */
const mockShowTableOk = (decoded: Record<string, unknown>) =>
  vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(showTableEnvelope(decoded)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
  );

// ─── Fixture bodies ────────────────────────────────────────────────────────────

const QUALIFIED = "demo_schema.demo_table";

// The stored baseline: col_a narrow, col_b stable, col_gone about to disappear.
const APPLY_STORED = {
  col_a: { base: "string", refinements: ["char4"] },
  col_b: { base: "string", refinements: ["char16"] },
  col_gone: { base: "int", refinements: ["int8"] as string[] },
};

// Live now: col_a WIDENED (retype), col_b unchanged, col_gone REMOVED, col_ts ADDED.
// One changeset carrying an addition, a removal AND a retype -- the shape SSYNC-V125-15 says
// must apply without a force flag.
const APPLY_LIVE_BODY = {
  table_names: [QUALIFIED],
  type_schemas: [
    JSON.stringify({
      type: "record",
      name: "type_name",
      fields: [
        { name: "col_a", type: "string" },
        { name: "col_b", type: "string" },
        { name: "col_ts", type: "long" },
      ],
    }),
  ],
  properties: [
    {
      col_a: ["data", "char32"],
      col_b: ["data", "char16"],
      col_ts: ["data", "timestamp"],
    },
  ],
};

/**
 * What parseColumnFingerprints(APPLY_LIVE_BODY) yields — i.e. exactly what the check response
 * hands the client, and therefore exactly what the client echoes back as `live`. Written as a
 * LITERAL rather than computed by calling the parser, so that a change in the parser shows up
 * here as a staleness refusal instead of being silently absorbed on both sides.
 */
const APPLY_REPORTED_LIVE = {
  col_a: { base: "string", refinements: ["char32"] },
  col_b: { base: "string", refinements: ["char16"] },
  col_ts: { base: "long", refinements: ["timestamp"] },
};

// Real body -- 122-SPIKE-NOTES.md Q5, the no_error_if_not_exists: true probe.
const MISSING_BODY = {
  table_name: QUALIFIED,
  table_names: [] as string[],
  type_schemas: [] as unknown[],
  properties: [] as unknown[],
  info: { WARNING_0: "Could not find the table: '…' (TM/SMc:1046)" },
};

// Structurally malformed -- NO table_names array at all => tablePresence() "unreadable",
// a THIRD state distinct from "missing".
const NO_TABLE_NAMES_BODY = {
  some_other_field: "not a show/table response",
};

// ─── Snapshot helpers ──────────────────────────────────────────────────────────

const tablesRow = (id: number) =>
  db.prepare("SELECT columns, columns_fingerprint FROM tables WHERE id = ?").get(id);

const historyCount = (tableId: number): number =>
  (db.prepare("SELECT COUNT(*) c FROM table_sync_history WHERE table_id = ?").get(tableId) as { c: number }).c;

// ─── Cleanup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.unstubAllGlobals();
  db.exec("DELETE FROM sessions");
  // tables is deleted LAST-ish on purpose: table_sync_history and table_sync_history_meta
  // both declare ON DELETE CASCADE to tables(id), and better-sqlite3 enforces foreign keys
  // by default (measured in 125-01), so this clears the history too.
  db.exec("DELETE FROM widgets");
  db.exec("DELETE FROM dashboards");
  db.exec("DELETE FROM column_display_config");
  db.exec("DELETE FROM tables");
  // Custom roles are re-seeded per test under fixed names; role_permissions and user_roles
  // cascade from roles.
  db.exec("DELETE FROM user_roles");
  db.exec("DELETE FROM roles WHERE built_in = 0");
});

// ═══════════════════════════════════════════════════════════════════════════════
describe("POST /api/tables/:id/schema-apply", () => {
  it("GATE-analyst: an analyst session is refused (403), and no Kinetica call is made", async () => {
    const table = createTable({ name: "demo_table", schema: "demo_schema" });
    setStoredFingerprint(table.id, APPLY_STORED);
    const fetchMock = mockShowTableOk(APPLY_LIVE_BODY);
    vi.stubGlobal("fetch", fetchMock);

    const { cookie } = seedAnalystSession("demo_analyst");
    const app = await buildTestApp();
    const res = await app
      .post(`/api/tables/${table.id}/schema-apply`)
      .set("Cookie", cookie)
      .send({ live: APPLY_REPORTED_LIVE });

    expect(res.status).toBe(403);
    expect(historyCount(table.id)).toBe(0);
  });

  it("GATE-datasets-only: a session holding ONLY datasets:manage is refused (403) — the second half of the AND-gate is enforced", async () => {
    const table = createTable({ name: "demo_table", schema: "demo_schema" });
    setStoredFingerprint(table.id, APPLY_STORED);
    vi.stubGlobal("fetch", mockShowTableOk(APPLY_LIVE_BODY));

    const { cookie } = seedDatasetsManageOnlySession("demo_manage_only");
    const app = await buildTestApp();
    const res = await app
      .post(`/api/tables/${table.id}/schema-apply`)
      .set("Cookie", cookie)
      .send({ live: APPLY_REPORTED_LIVE });

    expect(res.status).toBe(403);
    expect(historyCount(table.id)).toBe(0);
  });

  it("GATE-admin: an admin session reaches the handler and applies", async () => {
    const table = createTable({ name: "demo_table", schema: "demo_schema" });
    setStoredFingerprint(table.id, APPLY_STORED);
    vi.stubGlobal("fetch", mockShowTableOk(APPLY_LIVE_BODY));

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    const res = await app
      .post(`/api/tables/${table.id}/schema-apply`)
      .set("Cookie", cookie)
      .send({ live: APPLY_REPORTED_LIVE });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("applied");
  });

  it("ONECALL-showtable: exactly ONE Kinetica call, to /show/table, carrying options.no_error_if_not_exists = 'true'", async () => {
    const table = createTable({ name: "demo_table", schema: "demo_schema" });
    setStoredFingerprint(table.id, APPLY_STORED);
    const fetchMock = mockShowTableOk(APPLY_LIVE_BODY);
    vi.stubGlobal("fetch", fetchMock);

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    const res = await app
      .post(`/api/tables/${table.id}/schema-apply`)
      .set("Cookie", cookie)
      .send({ live: APPLY_REPORTED_LIVE });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/show/table");
    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse((init as { body: string }).body);
    expect(sentBody.options.no_error_if_not_exists).toBe("true");
  });

  it("ONECALL-upstream: an unreadable /show/table body is a 502, never a 200 finding, and writes nothing", async () => {
    const table = createTable({ name: "demo_table", schema: "demo_schema" });
    setStoredFingerprint(table.id, APPLY_STORED);
    const before = tablesRow(table.id);
    vi.stubGlobal("fetch", mockShowTableOk(NO_TABLE_NAMES_BODY));

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    const res = await app
      .post(`/api/tables/${table.id}/schema-apply`)
      .set("Cookie", cookie)
      .send({ live: APPLY_REPORTED_LIVE });

    expect(res.status).toBe(502);
    expect(res.body).not.toHaveProperty("outcome");
    expect(tablesRow(table.id)).toEqual(before);
    expect(historyCount(table.id)).toBe(0);
  });

  it("REFUSE-stale: Kinetica moved since the report was built -> 409 stale, tables row and history untouched", async () => {
    const table = createTable({ name: "demo_table", schema: "demo_schema" });
    setStoredFingerprint(table.id, APPLY_STORED);
    const before = tablesRow(table.id);
    vi.stubGlobal("fetch", mockShowTableOk(APPLY_LIVE_BODY));

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    // The client echoes back the OLD stored map -- i.e. a report built before the widening.
    const res = await app
      .post(`/api/tables/${table.id}/schema-apply`)
      .set("Cookie", cookie)
      .send({ live: APPLY_STORED });

    expect(res.status).toBe(409);
    expect(res.body.outcome).toBe("stale");
    expect(res.body.message).toContain("Re-run the check");
    expect(tablesRow(table.id)).toEqual(before);
    expect(historyCount(table.id)).toBe(0);
  });

  it("REFUSE-missing: a table Kinetica no longer has -> 409 table_missing, and the registered schema is NOT blanked", async () => {
    const table = createTable({ name: "demo_table", schema: "demo_schema" });
    setStoredFingerprint(table.id, APPLY_STORED);
    const before = tablesRow(table.id);
    vi.stubGlobal("fetch", mockShowTableOk(MISSING_BODY));

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    const res = await app
      .post(`/api/tables/${table.id}/schema-apply`)
      .set("Cookie", cookie)
      .send({ live: APPLY_REPORTED_LIVE });

    expect(res.status).toBe(409);
    expect(res.body.outcome).toBe("table_missing");
    // Reused from the check's own tableMissingResult, so the two routes cannot drift into
    // saying different things about the same situation.
    expect(res.body.message).toContain("Kinetica no longer has a table named");
    expect(tablesRow(table.id)).toEqual(before);
    expect(historyCount(table.id)).toBe(0);
  });

  it("REFUSE-badbody: a missing or EMPTY live map is a 400 and never reaches Kinetica", async () => {
    const table = createTable({ name: "demo_table", schema: "demo_schema" });
    setStoredFingerprint(table.id, APPLY_STORED);
    const before = tablesRow(table.id);
    const fetchMock = mockShowTableOk(APPLY_LIVE_BODY);
    vi.stubGlobal("fetch", fetchMock);

    const { cookie } = createAdminSession();
    const app = await buildTestApp();

    const noLive = await app.post(`/api/tables/${table.id}/schema-apply`).set("Cookie", cookie).send({});
    expect(noLive.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    // THE most dangerous edge in this phase: isStaleAgainst({}, {}) is false and
    // renderColumnsMap({}) is {}, so an empty map from a failed client-side read would sail
    // through the lib and WIPE tables.columns. The route is the only thing standing there.
    const emptyLive = await app
      .post(`/api/tables/${table.id}/schema-apply`)
      .set("Cookie", cookie)
      .send({ live: {} });
    expect(emptyLive.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    expect(tablesRow(table.id)).toEqual(before);
    expect(historyCount(table.id)).toBe(0);
  });

  it("REFUSE-404: an unknown table id is a 404 and never reaches Kinetica", async () => {
    const fetchMock = mockShowTableOk(APPLY_LIVE_BODY);
    vi.stubGlobal("fetch", fetchMock);

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    const res = await app
      .post(`/api/tables/999999/schema-apply`)
      .set("Cookie", cookie)
      .send({ live: APPLY_REPORTED_LIVE });

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PERSIST-diff: a valid apply is 200 applied/diff, and a following schema-check on the SAME live body reports hasChanges false", async () => {
    const table = createTable({ name: "demo_table", schema: "demo_schema" });
    setStoredFingerprint(table.id, APPLY_STORED);
    vi.stubGlobal("fetch", mockShowTableOk(APPLY_LIVE_BODY));

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    const applied = await app
      .post(`/api/tables/${table.id}/schema-apply`)
      .set("Cookie", cookie)
      .send({ live: APPLY_REPORTED_LIVE });

    expect(applied.status).toBe(200);
    expect(applied.body.outcome).toBe("applied");
    expect(applied.body.kind).toBe("diff");
    expect(applied.body.columns).toEqual({
      col_a: "string(char32)",
      col_b: "string(char16)",
      // renderColumnType maps the temporal marker to the tables.columns vocabulary rather
      // than to long(timestamp) -- the whole reason 125-02 exists.
      col_ts: "timestamp",
    });

    // ROADMAP criterion 1, expressed through the app's OWN read path rather than a db peek.
    const check = await app.get(`/api/tables/${table.id}/schema-check`).set("Cookie", cookie);
    expect(check.status).toBe(200);
    expect(check.body.outcome).toBe("diff");
    expect(check.body.hasChanges).toBe(false);
  });

  it("PERSIST-breaking: a changeset carrying BOTH removals and retypes applies with no force flag and no refusal", async () => {
    const table = createTable({ name: "demo_table", schema: "demo_schema" });
    setStoredFingerprint(table.id, APPLY_STORED);
    // A widget bound to the column that is about to disappear, so the stored impact report is
    // non-vacuous rather than three empty sections.
    const dashboard = createDashboard("Demo Dashboard", "");
    createWidget(dashboard.id, {
      title: "Demo Widget",
      type: "chart",
      position: 0,
      config: { tableId: table.id, metricColumn: "col_gone" },
    });
    vi.stubGlobal("fetch", mockShowTableOk(APPLY_LIVE_BODY));

    const { cookie } = createAdminSession();
    const app = await buildTestApp();
    const res = await app
      .post(`/api/tables/${table.id}/schema-apply`)
      .set("Cookie", cookie)
      .send({ live: APPLY_REPORTED_LIVE });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("applied");
    expect(res.body.changeset.removed.map((r: { column: string }) => r.column)).toEqual(["col_gone"]);
    expect(res.body.changeset.retyped.map((r: { column: string }) => r.column)).toEqual(["col_a"]);
    expect(res.body.changeset.added.map((a: { column: string }) => a.column)).toEqual(["col_ts"]);

    // The report stored alongside it names the affected widget -- a stored report describing
    // nothing would satisfy "an entry exists" while being useless as a worklist.
    const entry = listTableSyncHistory(table.id).entries[0];
    expect(entry.kind).toBe("diff");
    const breaking = entry.report!.sections.find((s) => s.severity === "breaking")!;
    expect(breaking.columns[0].column).toBe("col_gone");
    expect(breaking.columns[0].records.length).toBeGreaterThan(0);
  });

  it("PERSIST-actor: the recorded entry's actor is the SESSION's username, not a constant", async () => {
    const table = createTable({ name: "demo_table", schema: "demo_schema" });
    setStoredFingerprint(table.id, APPLY_STORED);
    vi.stubGlobal("fetch", mockShowTableOk(APPLY_LIVE_BODY));

    const { cookie } = seedSchemaSyncSession("demo_operator");
    const app = await buildTestApp();
    const res = await app
      .post(`/api/tables/${table.id}/schema-apply`)
      .set("Cookie", cookie)
      .send({ live: APPLY_REPORTED_LIVE });

    expect(res.status).toBe(200);
    const entry = listTableSyncHistory(table.id).entries[0];
    expect(entry.actor).toBe("demo_operator");
    // Guards against a hardcoded fallback that happens to look plausible.
    expect(entry.actor).not.toBe("system");
    expect(entry.actor).not.toBe(process.env.APP_ADMIN_USERNAME || "admin");
  });
});

