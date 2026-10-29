// 137: pure builder for the POST /api/ai/ask body. Structure only - never row or filter values
// (AIGOV-V20-02). Filters are reported as source + column + operator names only. The binding key set is CLOSED: no other widget config key is ever copied.
import type { AskRequest } from "@kinetica-bi/shared";
import type { Turn, SavedChatItem } from "./types";

// Phase 143: the snapshot builder moved to @kinetica-bi/shared so the server can build the same snapshot.
export { buildAskSnapshot, type AskRect } from "@kinetica-bi/shared";

const MAX_BODY_BYTES = 60_000; // under ASK_REQUEST_MAX_BYTES (65_536) with headroom
const RECENT_ANSWER_TURNS = 8;
const RECENT_ANSWER_CHARS = 1500;

export function buildAskTurns(turns: readonly Turn[], cursor: number, saved: readonly SavedChatItem[] = []): AskRequest["turns"] {
  // 141 D-18: kept (saved) turns stay as provider history, ahead of the live turns; notes are display-only.
  const savedTurns = saved.flatMap((x) =>
    x.kind === "turn" ? [{ id: x.id, prompt: x.prompt, answer: x.answer, entries: [], createdAt: 0, ...(x.chat ? { chat: x.chat } : {}) } as Turn] : [],
  );
  const kept = [...savedTurns, ...turns.slice(0, cursor + 1)].filter((t) => !t.chat || t.chat.status === "ok");
  const firstRecent = Math.max(0, kept.length - RECENT_ANSWER_TURNS);
  return kept.map((t, i) => {
    const changes: AskRequest["turns"][number]["changes"] = [];
    for (const label of t.chat?.applied ?? []) changes.push({ label: label.slice(0, 200), status: "applied" });
    for (const s of t.chat?.skipped ?? []) {
      const reason = s.reasons[0];
      changes.push({
        label: s.label.slice(0, 200),
        status: "skipped",
        ...(reason !== undefined ? { reason: reason.slice(0, 200) } : {}),
      });
    }
    return {
      question: t.prompt.slice(0, 2000),
      answer: i >= firstRecent ? t.answer.slice(0, RECENT_ANSWER_CHARS) : "",
      changes: changes.slice(0, 30),
    };
  });
}

export function buildAskRequest(input: {
  dashboardId: number;
  question: string;
  snapshot: AskRequest["snapshot"];
  turns: readonly Turn[];
  cursor: number;
  removalApproved: boolean;
  savedTurns?: readonly SavedChatItem[];
}): AskRequest {
  const turns = buildAskTurns(input.turns, input.cursor, input.savedTurns).slice(-50);
  const make = (): AskRequest => ({
    dashboardId: input.dashboardId,
    question: input.question.trim().slice(0, 2000),
    snapshot: input.snapshot,
    turns,
    ...(input.removalApproved ? { approvals: { removeSaved: true } } : {}),
  });
  const enc = new TextEncoder();
  // Drop the OLDEST turn until the body fits under the cap.
  while (turns.length > 0 && enc.encode(JSON.stringify(make())).length >= MAX_BODY_BYTES) turns.shift();
  return make();
}
