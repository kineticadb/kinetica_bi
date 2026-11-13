// 152-01 (VIEWAI-V22-01): the per-dashboard Viewer AI setting - storage default, PATCH validation, migration.
import { describe, it, expect, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { buildTestApp } from "./helpers/app";
import { sessionFor } from "./helpers/aiRouteKit";
import { db, createDb } from "../src/db";

const cleanFixtures = () => {
  db.exec("DELETE FROM sessions; DELETE FROM user_roles; DELETE FROM dashboard_layers; DELETE FROM dashboard_table_views; DELETE FROM dashboard_tables; DELETE FROM tables; DELETE FROM dashboards;");
};
const versionOf = (id: number) => (db.prepare("SELECT version FROM dashboards WHERE id = ?").get(id) as { version: number }).version;
const BAD = { error: "viewer_ai must be 'off', 'answers_filters' or 'session_only'." };

describe("dashboards.viewer_ai (152)", () => {
  beforeEach(cleanFixtures);

  const setup = async () => {
    const agent = await buildTestApp();
    const { cookie } = sessionFor("vai_designer", ["designer"]);
    const created = await agent.post("/api/dashboards").set("Cookie", cookie).send({ name: "VAI" });
    expect(created.status).toBe(201);
    const id = created.body.id as number;
    const read = async () => ((await agent.get("/api/dashboards").set("Cookie", cookie)).body.data as { id: number; viewer_ai: string }[]).find((d) => d.id === id)!;
    return { agent, cookie, id, created, read };
  };

  it("VAISET-1: a new dashboard reads session_only in the create response and the list", async () => {
    const { created, read } = await setup();
    expect(created.body.viewer_ai).toBe("session_only");
    expect((await read()).viewer_ai).toBe("session_only");
  });

  it("VAISET-2: a NULL or unknown stored value reads session_only", async () => {
    const { id, read } = await setup();
    db.prepare("UPDATE dashboards SET viewer_ai = NULL WHERE id = ?").run(id);
    expect((await read()).viewer_ai).toBe("session_only");
    db.prepare("UPDATE dashboards SET viewer_ai = 'bogus' WHERE id = ?").run(id);
    expect((await read()).viewer_ai).toBe("session_only");
  });

  it("VAISET-3: a designer can PATCH each mode, the list agrees and the version bumps", async () => {
    const { agent, cookie, id, read } = await setup();
    for (const mode of ["off", "answers_filters", "session_only"]) {
      const before = versionOf(id);
      const res = await agent.patch(`/api/dashboards/${id}`).set("Cookie", cookie).send({ viewer_ai: mode });
      expect(res.status).toBe(200);
      expect(res.body.viewer_ai).toBe(mode);
      expect((await read()).viewer_ai).toBe(mode);
      expect(versionOf(id)).toBeGreaterThan(before);
    }
  });

  it("VAISET-4: an invalid or null value is a 400, the stored value stays, a rename keeps the mode", async () => {
    const { agent, cookie, id, read } = await setup();
    await agent.patch(`/api/dashboards/${id}`).set("Cookie", cookie).send({ viewer_ai: "answers_filters" }).expect(200);
    const bad = await agent.patch(`/api/dashboards/${id}`).set("Cookie", cookie).send({ viewer_ai: "everyone" });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual(BAD);
    expect((await agent.patch(`/api/dashboards/${id}`).set("Cookie", cookie).send({ viewer_ai: null })).status).toBe(400);
    expect((await read()).viewer_ai).toBe("answers_filters");
    await agent.patch(`/api/dashboards/${id}`).set("Cookie", cookie).send({ viewer_ai: "off" }).expect(200);
    await agent.patch(`/api/dashboards/${id}`).set("Cookie", cookie).send({ name: "Renamed" }).expect(200);
    expect((await read()).viewer_ai).toBe("off");
  });

  it("VAISET-5: the migration is idempotent and adds viewer_ai to dashboards and ai_audit", () => {
    const file = path.join(os.tmpdir(), `kbi-vai-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    try {
      const a = createDb(file);
      a.close();
      const b = createDb(file);
      for (const table of ["dashboards", "ai_audit"]) {
        const cols = (b.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
        expect(cols).toContain("viewer_ai");
      }
      b.close();
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
    }
  });
});
