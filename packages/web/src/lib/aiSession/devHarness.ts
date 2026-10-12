// DEV ONLY. Loaded through an `import.meta.env.DEV`-gated dynamic import in DashboardsPage, so
// the branch (and this module) is eliminated from production bundles. Lets the operator drive
// scripted AI turns from the browser console. Phase 137's AI widget replaces it as the real driver.
import type { WidgetDto } from "../../api/client";
import type { TurnInput, TurnEntry } from "./types";
import { useAiSessionStore, hasUnsavedAiChanges } from "../../store/aiSessionStore";

type Actions = {
  applyTurn(input: TurnInput): { turnId: string; entries: TurnEntry[] };
  setCursor(i: number): void;
  discard(): void;
};

type Harness = {
  turn(ops: unknown[], prompt?: string): { turnId: string; entries: TurnEntry[] };
  addWidget(type?: string, title?: string, config?: Record<string, unknown>): { turnId: string; entries: TurnEntry[] };
  removeWidget(id: number): { turnId: string; entries: TurnEntry[] };
  patchWidget(id: number, configPatch: Record<string, unknown>): { turnId: string; entries: TurnEntry[] };
  revert(index: number): void;
  forward(index: number): void;
  discard(): void;
  state(): unknown;
  help(): void;
};

declare global {
  interface Window {
    __kbiAiHarness?: Harness;
  }
}

export function installAiDevHarness(actions: Actions, getSavedWidgets: () => readonly WidgetDto[]): () => void {
  const run = (ops: unknown[], prompt = "harness turn") => {
    const res = actions.applyTurn({ prompt, ops });
    console.table(res.entries.map((e) => ({ op: (e.op as { op?: string } | null)?.op ?? "?", ...e.result })));
    return res;
  };
  const harness: Harness = {
    turn: run,
    addWidget: (type = "records", title = "AI widget", config = {}) =>
      run([{ op: "add_widget", tempId: useAiSessionStore.getState().allocateTempId(), type, title, config }]),
    removeWidget: (id) => run([{ op: "remove_widget", id }]),
    patchWidget: (id, configPatch) => run([{ op: "patch", action: { target: { kind: "widget", id }, configPatch } }]),
    // -1 = the saved dashboard; N = state after turn N
    revert: (index) => actions.setCursor(index),
    forward: (index) => actions.setCursor(index),
    discard: () => actions.discard(),
    state: () => {
      const s = useAiSessionStore.getState();
      return {
        turns: s.turns.map((t) => ({ id: t.id, prompt: t.prompt, results: t.entries.map((e) => e.result) })),
        cursor: s.cursor,
        droppedCount: s.droppedCount,
        hasUnsavedAiChanges: hasUnsavedAiChanges(),
        geometry: s.geometry,
      };
    },
    help: () => {
      const saved = getSavedWidgets().map((w) => `${w.id}:${w.type}`).join(", ") || "(none)";
      console.log(
        [
          "__kbiAiHarness (DEV only)",
          "  addWidget(type='records', title, config)   removeWidget(id)   patchWidget(id, configPatch)",
          "  turn(ops[], prompt)   revert(i)/forward(i) (-1 = saved dashboard)   discard()   state()",
          "  map widgets accept show_popup / show_scale_bar / show_fullscreen; records accept page_size",
          `  saved widgets: ${saved}`,
        ].join("\n"),
      );
    },
  };
  window.__kbiAiHarness = harness;
  return () => {
    if (window.__kbiAiHarness === harness) delete window.__kbiAiHarness;
  };
}
