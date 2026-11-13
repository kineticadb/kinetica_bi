// 152-01 (VIEWAI-V22-01): import restores a valid viewer_ai; anything else imports as Session only.
import { describe, it, expect, beforeEach } from "vitest";
import { db, createDashboard, getDashboard } from "../src/db";
import { buildDashboardExport } from "../src/lib/dashboardExport";
import { applyDashboardImport } from "../src/lib/dashboardImport";
import type { DashboardExportFile } from "../src/lib/dashboardExport";

const reset = () => db.exec("DELETE FROM dashboard_access_grants; DELETE FROM dashboard_layers; DELETE FROM dashboard_dynamic_views; DELETE FROM widgets; DELETE FROM dashboard_tables; DELETE FROM custom_metrics; DELETE FROM dashboards; DELETE FROM tables; DELETE FROM sessions;");
const fileWith = (mode?: unknown): DashboardExportFile => {
  reset();
  const d = createDashboard("VAIIMP source", "");
  const file = buildDashboardExport(d.id)!;
  reset();
  const dash = file.dashboard as unknown as Record<string, unknown>;
  if (mode === undefined) delete dash.viewer_ai;
  else dash.viewer_ai = mode;
  return file;
};
const imported = (file: DashboardExportFile) => getDashboard(applyDashboardImport(file).dashboardId)!.viewer_ai;

beforeEach(reset);

describe("import restores viewer_ai (152)", () => {
  it("VAIIMP-1: a file carrying off or answers_filters imports as that mode", () => {
    expect(imported(fileWith("off"))).toBe("off");
    expect(imported(fileWith("answers_filters"))).toBe("answers_filters");
  });

  it("VAIIMP-2: a file without the key, or with a bad value, imports as session_only", () => {
    expect(imported(fileWith(undefined))).toBe("session_only");
    expect(imported(fileWith("everyone"))).toBe("session_only");
  });
});
