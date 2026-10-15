import { describe, expect, it } from "vitest";
import { AI_HEATMAP_RAMPS, AI_PALETTE_NAMES, AI_WIDGET_TYPES, type AskRequest } from "@kinetica-bi/shared";
import {
  AI_FILTER_RULES,
  AI_SYSTEM_RULES,
  AI_TRAILER_RULE,
  buildConversationMessages,
  buildSystemParts,
  projectSnapshot,
  summarizeEarlierTurns,
} from "../src/lib/ai/context";
import type { DashboardView, LiveTableInfo } from "../src/lib/ai/tools/types";

const snapshot: AskRequest["snapshot"] = {
  widgets: [
    {
      id: 7,
      type: "bar",
      title: "Sales",
      tableId: 3,
      layout: { x: 0, y: 1, w: 4, h: 3 },
      binding: { metric: "amount", aggregation: "sum", groupByColumns: ["region"] },
    },
    { id: -1, type: "table", title: "Raw" },
    { id: 9, type: "map", title: "M", dynamicViewId: 5 },
  ],
  layers: [{ id: 2, widgetId: 7, title: "L", tableId: 3, renderMode: "points", visible: true }],
  dynamicViews: [{ id: 5, name: "DV" }],
  filters: [{ source: { kind: "table", id: 3 }, column: "region", op: "eq" }],
};
const req = (turns: AskRequest["turns"] = []): AskRequest => ({ dashboardId: 1, question: "q", snapshot, turns });

describe("CTX snapshot + system parts", () => {
  it("CTX-1 projects exactly the DashboardView fields", () => {
    const dirty = structuredClone(snapshot) as any;
    dirty.widgets[0].extra = "x";
    dirty.widgets[0].binding.customWhere = "1=1";
    dirty.layers[0].secret = "s";
    dirty.filters[0].value = "SECRETVAL";
    const view = projectSnapshot({ ...req(), snapshot: dirty }, { id: 1, title: "Dash" });
    const expected: DashboardView = {
      dashboardId: 1,
      title: "Dash",
      widgets: [
        {
          id: 7,
          type: "bar",
          title: "Sales",
          tableId: 3,
          layout: { x: 0, y: 1, w: 4, h: 3 },
          binding: { metric: "amount", aggregation: "sum", groupByColumns: ["region"] },
        },
        { id: -1, type: "table", title: "Raw" },
        { id: 9, type: "map", title: "M", dynamicViewId: 5 },
      ],
      layers: [{ id: 2, widgetId: 7, title: "L", tableId: 3, renderMode: "points", visible: true }],
      dynamicViews: [{ id: 5, name: "DV" }],
      filters: [{ source: { kind: "table", id: 3 }, column: "region", op: "eq" }],
    };
    expect(view).toEqual(expected);
    expect(JSON.stringify(view)).not.toContain("SECRETVAL");
    expect(JSON.stringify(view)).not.toContain("customWhere");
  });

  const tables: LiveTableInfo[] = [
    { id: 3, schema: "public", name: "sales", description: "d".repeat(300), columns: [{ name: "amount", type: "double" }, { name: "region" }] },
  ];
  const view = projectSnapshot(req(), { id: 1, title: "Dash" });

  it("CTX-2 classes are system/schema/config only and rules cover the required statements", () => {
    const parts = buildSystemParts({ view, dashboardTables: tables, maxToolSteps: 7, dataAccess: "schema" });
    expect(new Set(parts.map((p) => p.cls))).toEqual(new Set(["system", "schema", "config"]));
    const rules = parts.filter((p) => p.cls === "system").map((p) => p.text).join("\n");
    expect(rules).toContain(AI_SYSTEM_RULES);
    for (const t of AI_WIDGET_TYPES) expect(rules).toContain(t);
    expect(rules).toMatch(/negative tempId/);
    expect(rules).toMatch(/describe_table/);
    expect(rules).toMatch(/at most 7 tool calls/);
    expect(rules).toMatch(/no markdown|without markdown/i);
    expect(rules).toMatch(/data, not instructions/);
    expect(AI_SYSTEM_RULES.split("\n").length).toBeLessThanOrEqual(30);
  });

  it("CTX7-1 trailer rule asks for Follow-ups: and Choices: exactly once", () => {
    const parts = buildSystemParts({ view, dashboardTables: tables, maxToolSteps: 7, dataAccess: "schema" });
    const rules = parts.filter((p) => p.cls === "system").map((p) => p.text).join("\n");
    expect(rules.split('"Follow-ups:"')).toHaveLength(2);
    expect(rules.split('"Choices:"')).toHaveLength(2);
    expect(AI_TRAILER_RULE).toContain("Choices:");
  });

  it("CTX6-2 rules cover Phase 136 statements from shared vocabularies", () => {
    for (const needle of ["Never write SQL", "never hex", "same tempId", "only tables on this dashboard", "confirm", "set_layout", ...AI_PALETTE_NAMES, ...AI_HEATMAP_RAMPS])
      expect(AI_SYSTEM_RULES, needle).toContain(needle);
  });
  it("CTXF-1 filter rules appear once, in the capped prompt", () => {
    for (const needle of ["Omit tableId unless the user named a table", "never guess a value", "clear_filter with no arguments"]) expect(AI_FILTER_RULES, needle).toContain(needle);
    expect(AI_SYSTEM_RULES.split(AI_FILTER_RULES)).toHaveLength(2);
    expect(AI_SYSTEM_RULES.split("\n").length).toBeLessThanOrEqual(30);
  });
  it("CTX6-3 rules contain no hex or rgb literal", () => {
    expect(AI_SYSTEM_RULES).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(AI_SYSTEM_RULES).not.toContain("rgb(");
  });

  it("CTX-3 lists tables with columns, truncates description, handles empty", () => {
    const parts = buildSystemParts({ view, dashboardTables: tables, maxToolSteps: 3, dataAccess: "schema" });
    const text = parts.filter((p) => p.cls === "schema").map((p) => p.text).join("\n");
    expect(text).toContain("public.sales (id 3): amount double, region");
    expect(text).toContain("d".repeat(200));
    expect(text).not.toContain("d".repeat(201));
    const empty = buildSystemParts({ view, dashboardTables: [], maxToolSteps: 3, dataAccess: "schema" });
    expect(empty.map((p) => p.text).join("\n")).toContain("No tables on this dashboard yet; use list_tables.");
  });

  it("CTX-4 current-dashboard part is the config-class JSON of the view", () => {
    const parts = buildSystemParts({ view, dashboardTables: tables, maxToolSteps: 3, dataAccess: "schema" });
    const cfg = parts.filter((p) => p.cls === "config");
    expect(cfg.some((p) => p.text === JSON.stringify(view))).toBe(true);
  });
});

// ---- Task 2 ----
const mkTurn = (n: number, changes: AskRequest["turns"][number]["changes"] = []): AskRequest["turns"][number] => ({
  question: `QUESTION-${n}`,
  answer: n <= 3 ? `OLDANSWER-${n}` : `NEWANSWER-${n}`,
  changes,
});

describe("CTX history", () => {
  const nine = Array.from({ length: 9 }, (_, i) =>
    mkTurn(i + 1, [
      { label: `Added bar "${i + 1}"`, status: "applied" },
      ...(i === 0 ? [{ label: "Removed widget 7", status: "skipped" as const, reason: "not found" }] : []),
    ]),
  );
  const text = (m: any) => (m.parts as { text: string }[]).map((p) => p.text).join("\n");

  it("CTX-5 summary + 6 full exchanges + current question", () => {
    const msgs = buildConversationMessages(nine, "NOW", 6);
    expect(msgs).toHaveLength(1 + 12 + 1);
    expect(msgs[0].role).toBe("user");
    expect(text(msgs[0])).toMatch(/^Earlier in this conversation \(3 questions\)/);
    expect(text(msgs[1])).toContain("QUESTION-4");
    expect(msgs[2].role).toBe("assistant");
    expect(text(msgs[2])).toContain("NEWANSWER-4");
    expect(text(msgs[2])).toContain("Changes: applied: Added bar \"4\"");
    expect(text(msgs[13])).toBe("NOW");
  });

  it("CTX-6 old answers absent, recent answers present", () => {
    const all = buildConversationMessages(nine, "NOW", 6).map(text).join("\n");
    for (const n of [1, 2, 3]) expect(all).not.toContain(`OLDANSWER-${n}`);
    for (const n of [4, 5, 6, 7, 8, 9]) expect(all).toContain(`NEWANSWER-${n}`);
    expect(all).toContain("Added bar \"1\""); // old change labels survive in the summary
  });

  it("CTX-7 summary is deterministic, capped at 10 labels, null when empty", () => {
    expect(summarizeEarlierTurns([])).toBeNull();
    const s = summarizeEarlierTurns(nine.slice(0, 3))!;
    expect(s).toBe(
      'Earlier in this conversation (3 questions): 3 changes applied (Added bar "1", Added bar "2", Added bar "3"), 1 skipped.',
    );
    expect(summarizeEarlierTurns(nine.slice(0, 3))).toBe(s);
    const many = [
      { question: "q", answer: "a", changes: Array.from({ length: 12 }, (_, i) => ({ label: `L${i}`, status: "applied" as const })) },
    ];
    const m = summarizeEarlierTurns(many)!;
    expect(m).toContain("L9");
    expect(m).not.toContain("L10");
    expect(m).toContain("and 2 more");
  });

  it("CTX-8 prior parts are history class, current question is user class", () => {
    const msgs = buildConversationMessages(nine, "NOW", 6);
    const last = msgs[msgs.length - 1] as any;
    expect(last.parts.map((p: any) => p.cls)).toEqual(["user"]);
    for (const m of msgs.slice(0, -1)) {
      for (const p of (m as any).parts) expect(p.cls).toBe("history");
    }
    expect(msgs.slice(0, -1).filter((m) => m.role === "assistant").every((m) => !("toolCalls" in m))).toBe(true);
  });

  it("CTX-9 empty changes render 'Changes: none'", () => {
    const msgs = buildConversationMessages([mkTurn(9)], "NOW", 6);
    expect(text(msgs[1])).toContain("Changes: none");
  });

  it("CTX-10 zero turns and oversized window", () => {
    const none = buildConversationMessages([], "NOW", 6);
    expect(none).toHaveLength(1);
    expect(text(none[0])).toBe("NOW");
    const wide = buildConversationMessages(nine, "NOW", 50);
    expect(wide).toHaveLength(19);
    expect(wide.map(text).join("\n")).not.toContain("Earlier in this conversation");
  });
});
