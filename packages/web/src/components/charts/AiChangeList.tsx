// 151: the change list of one live answer, with per-line Undo/Redo and the inline "these depend on it" prompt.
// Undo is a fold without the entry (store + undoAiOps); this component only plans, asks and calls the orchestrators.
import { useEffect, useState } from "react";
import { useAiSessionStore } from "../../store/aiSessionStore";
import type { AskContext } from "../../lib/aiSession/askRunner";
import { AI_UNDO_COPY } from "../../lib/aiSession/chatText";
import { changeLines, planUndo, entryName, refKey, type UndoPlan } from "../../lib/aiSession/undoPlan";
import { undoAiOps, redoAiOps } from "../../lib/aiOps/undoAiOp";
import type { Turn } from "../../lib/aiSession/types";

type Prompt = { entryIndex: number; text: string; primary: string; keys: string };

function describePlan(plan: UndoPlan, turnId: string): { text: string; primary: string } {
  const s = useAiSessionStore.getState();
  const savedCount = s.savedTurns.filter((x) => x.kind === "turn").length;
  const names = plan.dependents.map((d) => {
    const t = d.ref.turnId === turnId ? undefined : s.turns.find((x) => x.id === d.ref.turnId);
    const label = d.turnIndex === -1 ? entryName({ entries: s.baseEntries, chat: undefined }, d.ref.entryIndex) : entryName(s.turns[d.turnIndex] ?? { entries: [], chat: undefined }, d.ref.entryIndex);
    return d.ref.turnId === turnId || d.turnIndex === -1 || !t ? label : `${label} (${AI_UNDO_COPY.answerRef(savedCount + d.turnIndex + 1)})`;
  });
  const lost = plan.handEdited ? ` ${AI_UNDO_COPY.editsLost}` : "";
  if (plan.dependents.length > 0) return { text: `${AI_UNDO_COPY.dependsOn(names, plan.refs.length)}${lost}`, primary: AI_UNDO_COPY.undoAll };
  return { text: `${AI_UNDO_COPY.confirmOne} ${AI_UNDO_COPY.editsLost}`, primary: AI_UNDO_COPY.undo };
}

export function AiChangeList({
  ctx,
  turn,
  offerUndo,
  disabled,
  fallbackLabels,
}: {
  ctx: AskContext;
  turn: Turn;
  turnIndex: number;
  /** live, status ok, at or before the cursor, not a pending proposal */
  offerUndo: boolean;
  /** an answer is running or a proposal is pending */
  disabled: boolean;
  /** capped labels for turns whose labels and entries do not line up */
  fallbackLabels: string[];
}) {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [note, setNote] = useState<{ entryIndex: number; text: string } | null>(null);
  useEffect(() => {
    if (disabled) {
      setPrompt(null);
      setNote(null);
    }
  }, [disabled]);

  const lines = changeLines(turn);
  if (!lines.some((l) => l.entryIndex !== null)) {
    return (
      <ul className="ai-chat-changes" aria-label="Dashboard changes">
        {fallbackLabels.map((c, ci) => (
          <li key={ci}>{c}</li>
        ))}
      </ul>
    );
  }

  const keysOf = (plan: UndoPlan) => plan.refs.map(refKey).join("|");

  function onUndo(entryIndex: number) {
    setNote(null);
    const plan = planUndo(ctx.getBaseline(), useAiSessionStore.getState(), { turnId: turn.id, entryIndex });
    if (!plan) return;
    if (plan.dependents.length === 0 && !plan.handEdited) {
      undoAiOps(plan.refs, ctx.getBaseline());
      return;
    }
    setPrompt({ entryIndex, ...describePlan(plan, turn.id), keys: keysOf(plan) });
  }

  function onConfirm(p: Prompt) {
    const plan = planUndo(ctx.getBaseline(), useAiSessionStore.getState(), { turnId: turn.id, entryIndex: p.entryIndex });
    if (!plan) {
      setPrompt(null);
      return;
    }
    if (keysOf(plan) !== p.keys) {
      // The set changed under the prompt: show the new one and let the user decide again.
      setPrompt({ entryIndex: p.entryIndex, ...describePlan(plan, turn.id), keys: keysOf(plan) });
      return;
    }
    undoAiOps(plan.refs, ctx.getBaseline());
    setPrompt(null);
  }

  function onRedo(entryIndex: number) {
    setPrompt(null);
    const r = redoAiOps({ turnId: turn.id, entryIndex }, ctx.getBaseline());
    setNote(r.ok ? null : { entryIndex, text: r.reason });
  }

  return (
    <ul className="ai-chat-changes" aria-label="Dashboard changes">
      {lines.map((line, ci) => (
        <li key={ci} className={line.undone ? "ai-chat-change--undone" : undefined}>
          <span>{line.label}</span>
          {line.undone && <span className="widget-filter-badge">{AI_UNDO_COPY.undoneTag}</span>}
          {offerUndo && line.entryIndex !== null && line.undoable && !line.undone && (
            <button type="button" className="ghost-sm muted" disabled={disabled} aria-label={`${AI_UNDO_COPY.undo} ${line.label}`} onClick={() => onUndo(line.entryIndex!)}>
              {AI_UNDO_COPY.undo}
            </button>
          )}
          {offerUndo && line.entryIndex !== null && line.undoable && line.undone && (
            <button type="button" className="ghost-sm muted" disabled={disabled} aria-label={`${AI_UNDO_COPY.redo} ${line.label}`} onClick={() => onRedo(line.entryIndex!)}>
              {AI_UNDO_COPY.redo}
            </button>
          )}
          {note?.entryIndex === line.entryIndex && line.entryIndex !== null && <div className="ai-chat-note muted">{note.text}</div>}
          {prompt?.entryIndex === line.entryIndex && line.entryIndex !== null && (
            <>
              <div className="ai-chat-note muted">{prompt.text}</div>
              <div className="ds-actions">
                <button type="button" className="btn-primary btn-sm" disabled={disabled} onClick={() => onConfirm(prompt)}>
                  {prompt.primary}
                </button>
                <button type="button" className="ghost-sm" disabled={disabled} onClick={() => setPrompt(null)}>
                  {AI_UNDO_COPY.cancel}
                </button>
              </div>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
