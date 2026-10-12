import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installAiDevHarness } from "./devHarness";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { baselineFixture } from "../../test/aiSessionHarness";

const baseline = baselineFixture();
type Row = Record<string, unknown>;

describe("devHarness feedback (GAP-134-02)", () => {
  let tableSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let uninstall: () => void;
  const h = () => window.__kbiAiHarness!;

  beforeEach(() => {
    useAiSessionStore.getState().reset();
    tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    uninstall = installAiDevHarness(
      {
        applyTurn: (input) => useAiSessionStore.getState().applyTurn(input, baseline),
        setCursor: (i) => useAiSessionStore.getState().setCursor(i, baseline),
        discard: () => useAiSessionStore.getState().reset(),
      },
      () => baseline.widgets,
    );
  });
  afterEach(() => {
    uninstall();
    useAiSessionStore.getState().reset();
    vi.restoreAllMocks();
  });

  const summary = (): Row => {
    const calls = tableSpy.mock.calls.map((c) => c[0] as Row[]).filter((rows) => rows[0] && "visibleAiWidgets" in rows[0]);
    return calls[calls.length - 1][0];
  };
  const turnList = (): Row[] => {
    const calls = tableSpy.mock.calls.map((c) => c[0] as Row[]).filter((rows) => rows[0] && "current" in rows[0]);
    return calls[calls.length - 1];
  };
  const build = () => {
    h().addWidget("records", "AI 1");
    h().patchWidget(42, { show_scale_bar: true });
    h().addWidget("bignumber", "AI 2");
  };

  it("HFB-1: position row shows cursor, turn count and visible AI widgets after a build", () => {
    build();
    const s = summary();
    expect(s.cursor).toBe(2);
    expect(s.turnCount).toBe(3);
    expect(String(s.visibleAiWidgets)).toContain("AI 1");
    expect(String(s.visibleAiWidgets)).toContain("AI 2");
  });

  it("HFB-2: revert(0) reports cursor 0, hides AI 2 and marks turn 0 current", () => {
    build();
    h().revert(0);
    const s = summary();
    expect(s.cursor).toBe(0);
    expect(s.turnCount).toBe(3);
    expect(String(s.visibleAiWidgets)).toContain("AI 1");
    expect(String(s.visibleAiWidgets)).not.toContain("AI 2");
    const cur = turnList().filter((r) => r.current);
    expect(cur).toHaveLength(1);
    expect(cur[0].index).toBe(0);
  });

  it("HFB-3: revert(-1) shows none; forward(2) shows both", () => {
    build();
    h().revert(-1);
    expect(summary().cursor).toBe(-1);
    expect(summary().visibleAiWidgets).toBe("(none)");
    h().forward(2);
    expect(summary().cursor).toBe(2);
    expect(String(summary().visibleAiWidgets)).toMatch(/AI 1.*AI 2|AI 2.*AI 1/);
  });

  it("HFB-4: turn() and removeWidget() also log the position row", () => {
    h().addWidget("records", "AI 1");
    tableSpy.mockClear();
    h().turn([{ op: "patch", action: { target: { kind: "widget", id: 42 }, configPatch: { show_popup: false } } }]);
    expect(summary().turnCount).toBe(2);
    tableSpy.mockClear();
    const id = useAiSessionStore.getState().derived.addedWidgets[0].id;
    h().removeWidget(id);
    expect(summary().turnCount).toBe(3);
    expect(summary().visibleAiWidgets).toBe("(none)");
  });

  it("HFB-5: help() explains turn numbering and suggests show_scale_bar: true", () => {
    h().help();
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("Turn indices include patch turns");
    expect(out).toContain("show_scale_bar: true");
  });
});
