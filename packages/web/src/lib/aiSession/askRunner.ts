// 137: the ask runner. Owns the AbortController and every store transition of one AI answer.
// Asks start ONLY from user handlers (click/Enter), never from effects: StrictMode double-invokes
// effects and would POST twice (quota).
//
// Ops are applied only from a `result` event, atomically, through applyTurn. Error, cancel and a
// lost connection apply zero ops. A late result after reset() (Discard / dashboard switch) is
// dropped by the epoch check.
import type { AiClarification, AskRequest, AskResultEvent } from "@kinetica-bi/shared";
import type { WidgetDto, DashboardLayerDto } from "../../api/client";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { useToastStore } from "../../store/toast";
import { streamAsk, AskHttpError, AI_CONNECTION_LOST } from "./askStream";
import { buildAskRequest } from "./buildAskRequest";
import { friendlyProgressLabel, AI_CHAT_COPY } from "./chatText";
import { changedWidgetIds } from "./changeCounts";
import type { StarterTable } from "./starterQuestions";
import type { SessionBaseline, TurnChat } from "./types";

export type AskContext = {
  dashboardId: number;
  getBaseline(): SessionBaseline; // saved dashboard baseline (same as the dev harness)
  getSnapshot(): AskRequest["snapshot"]; // effective dashboard at the cursor (buildAskSnapshot)
  tables: readonly StarterTable[]; // for starters / fallback follow-ups
};
export type AskPick = { turnIndex: number; clarificationIndex: number; optionId: string; approveRemoval?: boolean };

const RETRYABLE_CODES = ["AI_PROVIDER_ERROR", "AI_INTERNAL", "AI_TIMEOUT", "AI_CONNECTION_LOST", "AI_BUSY"];

let controller: AbortController | null = null;
let cancelled = false;

/** The user-visible reply text for a clicked choice (D-11). */
export function choiceQuestion(c: AiClarification, optionId: string): string {
  const opt = c.options.find((o) => o.id === optionId);
  if (c.kind === "confirm_remove") return optionId === "yes" ? "Yes, remove it" : "No, keep it";
  if (c.kind === "choose_map") return `Use the map "${opt?.label ?? optionId}" (widget ${optionId})`;
  return opt?.label ?? optionId;
}

export function cancelAsk(): void {
  if (!controller) return;
  cancelled = true;
  controller.abort();
}

function applyResult(ctx: AskContext, question: string, r: AskResultEvent): void {
  const store = useAiSessionStore.getState();
  const baseline = ctx.getBaseline();
  const pre = store.derived;
  const { entries } = store.applyTurn(
    {
      prompt: question,
      answer: r.text,
      ops: r.ops,
      chat: {
        status: "ok",
        answerId: r.answerId,
        followUps: r.followUps ?? [],
        clarifications: r.clarifications,
        skipped: r.skipped,
        applied: r.applied ?? [],
      },
    },
    baseline,
  );
  const post = useAiSessionStore.getState().derived;
  // 136-12 UAT finding 3: use EFFECTIVE includedLayerIds (saved list overridden by the session
  // contribution, before and after this answer) and every layer that existed before or after,
  // so editing/removing an AI-added layer still finds its host map.
  const effIds = (id: number): unknown[] | undefined => {
    const a = pre.contribution.widget[id]?.includedLayerIds;
    const b = post.contribution.widget[id]?.includedLayerIds;
    const ids = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
    return ids.length > 0 ? [...new Set(ids)] : undefined;
  };
  const widgets: WidgetDto[] = baseline.widgets.map((w) => {
    const inc = effIds(w.id);
    return inc ? { ...w, config: { ...w.config, includedLayerIds: inc } } : w;
  });
  widgets.push(...post.addedWidgets);
  const layers = new Map<number, DashboardLayerDto>();
  for (const l of [...baseline.layers, ...pre.addedLayers, ...post.addedLayers]) layers.set(l.id, l);
  useAiSessionStore.getState().setHighlight(changedWidgetIds(entries, { widgets, layers: [...layers.values()] }));
}

function recordError(baseline: SessionBaseline, question: string, err: { code: string; message: string }, status?: number): void {
  const store = useAiSessionStore.getState();
  const noAccess = err.code === "PERMISSION_DENIED" || status === 403;
  const message = noAccess ? AI_CHAT_COPY.noAccess : err.message;
  if (!noAccess) useToastStore.getState().showToast(message, "error"); // apiFetch already toasts a 403
  const retryable = status === 429 ? false : !noAccess && RETRYABLE_CODES.includes(err.code);
  const chat: TurnChat = { status: "error", errorCode: err.code, message, retryable };
  store.applyTurn({ prompt: question, ops: [], chat }, baseline);
}

export async function runAsk(ctx: AskContext, question: string, opts?: { pick?: AskPick }): Promise<void> {
  const q = question.trim();
  const store = useAiSessionStore.getState();
  if (!q || store.run.status === "running") return;
  if (opts?.pick) {
    if (opts.pick.approveRemoval) store.approveRemoval();
    store.markChoicePicked(opts.pick.turnIndex, {
      clarificationIndex: opts.pick.clarificationIndex,
      optionId: opts.pick.optionId,
    });
  }
  const epoch0 = store.epoch;
  store.startRun(q);
  store.setDraft("");
  const s = useAiSessionStore.getState();
  const body = buildAskRequest({
    dashboardId: ctx.dashboardId,
    question: q,
    snapshot: ctx.getSnapshot(),
    turns: s.turns,
    cursor: s.cursor,
    removalApproved: s.removalApproved,
  });
  const ctl = new AbortController();
  controller = ctl;
  cancelled = false;

  let result: AskResultEvent | null = null;
  let failure: { code: string; message: string; status?: number } | null = null;
  try {
    for await (const ev of streamAsk(body, ctl.signal)) {
      if (ev.event === "status" || ev.event === "step") {
        const cur = useAiSessionStore.getState().run.line;
        useAiSessionStore.getState().updateRun(friendlyProgressLabel(ev) ?? cur, ev.event === "status" ? ev.data.seconds : undefined);
      } else if (ev.event === "result") result = ev.data;
      else if (ev.event === "error") failure = { code: ev.data.code, message: ev.data.message };
    }
    if (!result && !failure) failure = { ...AI_CONNECTION_LOST };
  } catch (e) {
    if (ctl.signal.aborted) {
      /* user cancel; handled below */
    } else if (e instanceof AskHttpError) {
      failure = { code: e.code, message: e.message, status: e.status };
    } else {
      failure = { ...AI_CONNECTION_LOST };
    }
  }

  const cur = useAiSessionStore.getState();
  if (cur.epoch !== epoch0) {
    if (controller === ctl) controller = null;
    return; // reset() already cleared the run; drop the late outcome
  }
  if (ctl.signal.aborted || cancelled) {
    cur.applyTurn({ prompt: q, ops: [], chat: { status: "cancelled" } }, ctx.getBaseline());
    useAiSessionStore.getState().setDraft(q);
  } else if (result) {
    applyResult(ctx, q, result);
  } else if (failure && failure.status !== 401) {
    recordError(ctx.getBaseline(), q, failure, failure.status);
  }
  useAiSessionStore.getState().endRun();
  if (controller === ctl) controller = null;
  cancelled = false;
}
