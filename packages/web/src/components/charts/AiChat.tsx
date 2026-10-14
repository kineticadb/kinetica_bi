// 137-08: the AI conversation (log, empty state, progress, choices, follow-ups, revert, ask box).
// Reads the shared aiSessionStore; asks start ONLY from user handlers (never effects: StrictMode).
// All text renders as plain text (no HTML injection).
import { useEffect, useRef, useState } from "react";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { runAsk, cancelAsk, choiceQuestion, type AskContext } from "../../lib/aiSession/askRunner";
import { AI_CHAT_COPY, formatElapsed, describeSkipped } from "../../lib/aiSession/chatText";
import { buildStarterQuestions, buildTemplateFollowUps } from "../../lib/aiSession/starterQuestions";
import "./AiWidget.css";

const MAX_LEN = 2000;
const MAX_FOLLOWUPS = 3;

/** One status line while an answer is running (renders nothing when idle). */
export function AiRunStatus() {
  const run = useAiSessionStore((s) => s.run);
  const running = run.status === "running";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running, run.startedAt]);
  if (!running) return null;
  return (
    <div className="ai-chat-status" role="status">
      <span className="widget-filtering-spinner" aria-hidden="true" />
      <span>
        {run.line}
        {run.waitSeconds ? "" : formatElapsed(now - run.startedAt)}
      </span>
    </div>
  );
}

/** Ask box: Enter sends, Shift+Enter newline; Send becomes Cancel while running. Draft is shared. */
export function AiAskBox({ ctx }: { ctx: AskContext }) {
  const draft = useAiSessionStore((s) => s.draft);
  const setDraft = useAiSessionStore((s) => s.setDraft);
  const running = useAiSessionStore((s) => s.run.status === "running");
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, 4 * lh)}px`;
  }, [draft]);

  function send() {
    if (useAiSessionStore.getState().run.status === "running") return;
    if (!draft.trim()) return;
    void runAsk(ctx, draft);
  }

  return (
    <form
      className="ai-chat-input"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        ref={taRef}
        className="ds-select ai-chat-textarea"
        rows={1}
        maxLength={MAX_LEN}
        placeholder={AI_CHAT_COPY.askPlaceholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        aria-label="Ask the AI"
      />
      {running ? (
        <button type="button" className="ghost-sm" onClick={() => cancelAsk()}>
          Cancel
        </button>
      ) : (
        <button type="submit" className="btn-primary btn-sm" disabled={!draft.trim()}>
          Send
        </button>
      )}
    </form>
  );
}

export function AiChat({ ctx, variant }: { ctx: AskContext; variant: "inline" | "drawer" }) {
  const turns = useAiSessionStore((s) => s.turns);
  const cursor = useAiSessionStore((s) => s.cursor);
  const run = useAiSessionStore((s) => s.run);
  const running = run.status === "running";
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, run.status, run.line]);

  const starters = buildStarterQuestions(ctx.tables);

  return (
    <div className={`ai-chat ai-chat--${variant}`}>
      <div className="ai-chat-log" role="log" aria-live="polite" ref={logRef}>
        {turns.length === 0 && !running && (
          <div className="ai-chat-empty">
            <p className="muted">{AI_CHAT_COPY.emptyHint}</p>
            <div className="ai-chat-followups">
              {starters.map((q) => (
                <button key={q} type="button" className="ghost-sm" onClick={() => void runAsk(ctx, q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn, i) => {
          const status = turn.chat?.status ?? "ok";
          const chat = turn.chat;
          const isLast = i === turns.length - 1;
          const followUps =
            chat?.followUps && chat.followUps.length > 0 ? chat.followUps : buildTemplateFollowUps(ctx.tables, turn.prompt);
          return (
            <div key={turn.id} className={`ai-chat-turn${i > cursor ? " ai-chat-turn--ahead" : ""}`}>
              <div className="ai-chat-bubble ai-chat-bubble--user">{turn.prompt}</div>
              {status === "ok" && (
                <>
                  <div className="ai-chat-bubble ai-chat-bubble--ai">{turn.answer}</div>
                  {(chat?.skipped ?? []).map((s, si) => {
                    const t = describeSkipped(s);
                    return t ? (
                      <div key={si} className="ai-chat-note muted">
                        {t}
                      </div>
                    ) : null;
                  })}
                  {(chat?.clarifications ?? []).map((c, ci) => {
                    const picked = chat?.pickedChoice?.clarificationIndex === ci ? chat.pickedChoice.optionId : undefined;
                    const enabled = isLast && !chat?.pickedChoice && !running;
                    return (
                      <div key={ci} className="ai-chat-choices">
                        <span className="muted">{c.question}</span>
                        {c.options.map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            className="ghost-sm"
                            disabled={!enabled}
                            aria-pressed={picked !== undefined ? picked === o.id : undefined}
                            onClick={() =>
                              void runAsk(ctx, choiceQuestion(c, o.id), {
                                pick: {
                                  turnIndex: i,
                                  clarificationIndex: ci,
                                  optionId: o.id,
                                  approveRemoval: c.kind === "confirm_remove" && o.id === "yes",
                                },
                              })
                            }
                          >
                            {picked === o.id ? "✓ " : ""}
                            {o.label}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                  <div className="ai-chat-followups">
                    {followUps.slice(0, MAX_FOLLOWUPS).map((f) => (
                      <button key={f} type="button" className="ghost-sm" disabled={running} onClick={() => void runAsk(ctx, f)}>
                        {f}
                      </button>
                    ))}
                  </div>
                  <div className="ai-chat-turn-actions">
                    <button
                      type="button"
                      className="ghost-sm"
                      disabled={i === cursor || running}
                      onClick={() => useAiSessionStore.getState().setCursor(i, ctx.getBaseline())}
                    >
                      {AI_CHAT_COPY.revert}
                    </button>
                  </div>
                </>
              )}
              {status === "cancelled" && <div className="ai-chat-note muted">{AI_CHAT_COPY.cancelled}</div>}
              {status === "error" && (
                <>
                  <div className="ai-chat-bubble ai-chat-bubble--ai ai-chat-bubble--error">{chat?.message}</div>
                  {chat?.retryable && (
                    <div className="ai-chat-turn-actions">
                      <button type="button" className="ghost-sm" disabled={running} onClick={() => void runAsk(ctx, turn.prompt)}>
                        {AI_CHAT_COPY.retry}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
        {running && (
          <div className="ai-chat-turn">
            <div className="ai-chat-bubble ai-chat-bubble--user">{run.question}</div>
            <AiRunStatus />
          </div>
        )}
      </div>
      <AiAskBox ctx={ctx} />
    </div>
  );
}
