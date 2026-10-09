/**
 * Phase 130 EXPBOOT-not-in-createApp: boot reconciliation lives ONLY in the index.ts bootstrap IIFE.
 * createApp() (which every route spec calls) must never fail in-flight export jobs.
 */
import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { buildTestApp } from "./helpers/app";
import { db, insertExportJob, markExportJobRunning, getExportJob } from "../src/db";

const ids: string[] = [];
afterEach(() => {
  for (const id of ids.splice(0)) db.prepare("DELETE FROM export_jobs WHERE id = ?").run(id);
});

describe("export boot reconcile is not in createApp", () => {
  it("EXPBOOT-not-in-createApp: building the app twice leaves queued/running jobs untouched", async () => {
    const mk = (running: boolean) => {
      const id = randomUUID();
      ids.push(id);
      insertExportJob({ id, username: "alice", sid: "x", dashboardId: 1, widgetId: 1, specJson: "{}", optionsJson: null });
      if (running) markExportJobRunning(id);
      return id;
    };
    const queued = mk(false);
    const running = mk(true);
    await buildTestApp();
    await buildTestApp();
    expect(getExportJob(queued)?.status).toBe("queued");
    expect(getExportJob(running)?.status).toBe("running");
    expect(getExportJob(running)?.error ?? null).toBeNull();
  });
});
