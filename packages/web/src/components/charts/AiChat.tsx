// 137-08: the AI conversation (log, empty state, progress, choices, follow-ups, revert, ask box).
// Reads the shared aiSessionStore; asks start ONLY from user handlers (never effects: StrictMode).
// All text renders as plain text (no HTML injection).
import { useEffect, useRef, useState } from "react";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { runAsk, cancelAsk, choiceQuestion, type AskContext } from "../../lib/aiSession/askRunner";
import { AI_CHAT_COPY, turnChanges, formatElapsed, describeSkipped, formatQueriesToggle, describeQueryEntry } from "../../lib/aiSession/chatText";
import { buildStarterQuestions, buildTemplateFollowUps } from "../../lib/aiSession/starterQuestions";
import { useFilterStore } from "../../store/filterStore";
import { currentFilter, clearFilterAsUser } from "../../lib/aiOps/aiFilterApplier";
import { AI_FILTER_COPY } from "../../lib/aiOps/aiFilterCopy";
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
    // 137-12 UAT: an empty box stays one line (Chrome's scrollHeight counts a wrapped placeholder).
    if (!draft) {
      el.style.height = "";
      return;
    }
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
      {/* Distinct keys (142 UAT): a cancel can end the run and restore the draft before the click's default action,
          so a reused node re-typed to submit would re-send the cancelled question. */}
      {running ? (
        <button key="cancel" type="button" className="ghost-sm" onClick={() => cancelAsk()}>
          Cancel
        </button>
      ) : (
        <button key="send" type="submit" className="btn-primary btn-sm" disabled={!draft.trim()}>
          Send
        </button>
      )}
    </form>
  );
}

export function AiChat({ ctx, variant }: { ctx: AskContext; variant: "inline" | "drawer" }) {
  const turns = useAiSessionStore((s) => s.turns);
  const cursor = useAiSessionStore((s) => s.cursor);
  const savedTurns = useAiSessionStore((s) => s.savedTurns);
  const run = useAiSessionStore((s) => s.run);
  const running = run.status === "running";
  // 138: re-render the zero-row clear offer when filters change (primitive selector).
  useFilterStore((s) => s.filterVersion);
  const logRef = useRef<HTMLDivElement>(null);
  // 140 D-11: which turns have their "Ran N queries" list expanded (collapsed by default).
  const [openQueries, setOpenQueries] = useState<ReadonlySet<string>>(() => new Set());
  function toggleQueries(id: string) {
    setOpenQueries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, savedTurns.length, run.status, run.line]);

  const starters = buildStarterQuestions(ctx.tables);

  return (
    <div className={`ai-chat ai-chat--${variant}`}>
      <div className="ai-chat-log" role="log" aria-live="polite" ref={logRef}>
        {turns.length === 0 && savedTurns.length === 0 && !running && (
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
        {/* 141 D-11: saved (kept) turns are read-only: no revert, choices, follow-ups or filter offers. */}
        {savedTurns.map((x) =>
          x.kind === "note" ? (
            <div key={x.id} className="ai-chat-note muted">
              {x.text}
            </div>
          ) : (
            <div key={x.id} className="ai-chat-turn">
              <div className="ai-chat-bubble ai-chat-bubble--user">{x.prompt}</div>
              {(x.chat?.status ?? "ok") === "ok" && <div className="ai-chat-bubble ai-chat-bubble--ai">{x.answer}</div>}
              {(x.chat?.filterNotes ?? []).map((n, ni) => (
                <div key={`sfn-${ni}`} className="ai-chat-note muted">
                  {n}
                </div>
              ))}
              {(x.chat?.skipped ?? []).map((sk, si) => {
                const t = describeSkipped(sk);
                return t ? (
                  <div key={`ssk-${si}`} className="ai-chat-note muted">
                    {t}
                  </div>
                ) : null;
              })}
            </div>
          ),
        )}
        {turns.map((turn, i) => {
          const status = turn.chat?.status ?? "ok";
          const chat = turn.chat;
          const isLast = i === turns.length - 1;
          const hasChoices = (chat?.clarifications ?? []).length > 0;
          // 137-12 UAT: a clarification shows only the AI's own follow-ups (no local templates) and,
          // when it changed nothing, no Revert — the choices are the next step.
          const followUps =
            chat?.followUps && chat.followUps.length > 0
              ? chat.followUps
              : hasChoices
                ? []
                : buildTemplateFollowUps(ctx.tables, turn.prompt);
          const changedSomething = turn.entries.some((e) => e.result.status === "applied");
          const showRevert = !hasChoices || changedSomething;
          const changes = status === "ok" ? turnChanges(turn) : null;
          return (
            <div key={turn.id} className={`ai-chat-turn${i > cursor ? " ai-chat-turn--ahead" : ""}`}>
              <div className="ai-chat-bubble ai-chat-bubble--user">{turn.prompt}</div>
              {status === "ok" && (
                <>
                  <div className="ai-chat-bubble ai-chat-bubble--ai">{turn.answer}</div>
                  {changes?.kind === "applied" && (
                    <ul className="ai-chat-changes" aria-label="Dashboard changes">
                      {changes.labels.map((c, ci) => (
                        <li key={ci}>{c}</li>
                      ))}
                    </ul>
                  )}
                  {changes?.kind === "none" && <div className="ai-chat-note muted">{AI_CHAT_COPY.noChanges}</div>}
                  {(chat?.filterNotes ?? []).map((n, ni) => (
                    <div key={`fn-${ni}`} className="ai-chat-note muted">
                      {n}
                    </div>
                  ))}
                  {(chat?.queries ?? []).length > 0 && (
                    <>
                      <div className="ai-chat-turn-actions">
                        <button
                          type="button"
                          className="ghost-sm"
                          aria-expanded={openQueries.has(turn.id)}
                          onClick={() => toggleQueries(turn.id)}
                        >
                          {formatQueriesToggle((chat?.queries ?? []).length)}
                        </button>
                      </div>
                      {openQueries.has(turn.id) &&
                        (chat?.queries ?? []).map((q, qi) => (
                          <div key={`q-${qi}`} className="ai-chat-note muted ai-chat-query">
                            {q.sql} {"\u2014"} {describeQueryEntry(q)}
                          </div>
                        ))}
                    </>
                  )}
                  {(chat?.emptyFilters ?? [])
                    .filter((e) => currentFilter(e.source, e.column) !== null)
                    .map((e) => (
                      <div key={`ef-${e.source.kind}-${e.source.id}-${e.column}`} className="ai-chat-turn-actions">
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          aria-label={`Clear the ${e.column} filter`}
                          disabled={running}
                          onClick={() => clearFilterAsUser(e.source, e.column)}
                        >
                          {AI_FILTER_COPY.clearThisFilter}
                        </button>
                      </div>
                    ))}
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
                        {/* 137-12 UAT: the answer bubble usually already asks the question */}
                        {c.question.trim() !== turn.answer.trim() && <span className="muted">{c.question}</span>}
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
                  {followUps.length > 0 && (
                    <div className="ai-chat-followups">
                      {followUps.slice(0, MAX_FOLLOWUPS).map((f) => (
                        <button key={f} type="button" className="ghost-sm" disabled={running} onClick={() => void runAsk(ctx, f)}>
                          {f}
                        </button>
                      ))}
                    </div>
                  )}
                  {showRevert && (
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
                  )}
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
