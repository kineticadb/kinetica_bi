// 149 (FEEDBACK-V22-01): per-answer thumbs + optional down-vote reasons. Plain text only; the note is never sent to the AI.
import { useState } from "react";
import { rateAiAnswer, AI_RATING_REASONS, type AiRatingReason } from "../../api/client";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { useToastStore } from "../../store/toast";
import type { TurnChat } from "../../lib/aiSession/types";
import { ThumbUpIcon, ThumbDownIcon } from "./AiRatingIcons";

export const AI_RATING_COPY = {
  up: "Good answer",
  down: "Bad answer",
  reasonsPrompt: "What went wrong? (optional)",
  note: "Tell us more (optional)",
  send: "Send feedback",
  skip: "Skip",
  thanks: "Thanks for the feedback.",
  showToggle: "Show rating buttons",
  saveFailed: "Couldn't save your rating.",
} as const;

export const AI_RATING_REASON_LABEL: Record<AiRatingReason, string> = {
  wrong_data: "Wrong data",
  wrong_chart: "Wrong chart",
  not_what_asked: "Didn't do what I asked",
  other: "Other",
};

type RatingFields = Pick<TurnChat, "rating" | "ratingReasons" | "ratingNote" | "ratingFollowUp">;

/** Two thumbs as a fragment so both are direct children of the actions row. */
export function AiRatingButtons({ answerId, chat }: { answerId: number; chat: TurnChat }) {
  const [busy, setBusy] = useState(false);

  async function choose(target: "up" | "down") {
    const prev: RatingFields = {
      rating: chat.rating,
      ratingReasons: chat.ratingReasons,
      ratingNote: chat.ratingNote,
      ratingFollowUp: chat.ratingFollowUp,
    };
    const next = chat.rating === target ? null : target;
    const set = useAiSessionStore.getState().setTurnRating;
    set(answerId, next === null ? {} : next === "down" ? { rating: "down", ratingFollowUp: "ask" } : { rating: "up" });
    setBusy(true);
    try {
      await rateAiAnswer(answerId, { rating: next });
    } catch {
      set(answerId, prev);
      useToastStore.getState().showToast(AI_RATING_COPY.saveFailed, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="ai-chat-rate" aria-label={AI_RATING_COPY.up} aria-pressed={chat.rating === "up"} disabled={busy} onClick={() => void choose("up")}>
        <ThumbUpIcon filled={chat.rating === "up"} />
      </button>
      <button type="button" className="ai-chat-rate" aria-label={AI_RATING_COPY.down} aria-pressed={chat.rating === "down"} disabled={busy} onClick={() => void choose("down")}>
        <ThumbDownIcon filled={chat.rating === "down"} />
      </button>
    </>
  );
}

export function AiRatingReason({ answerId, chat }: { answerId: number; chat: TurnChat }) {
  const [picked, setPicked] = useState<ReadonlySet<AiRatingReason>>(() => new Set());
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  if (chat.rating !== "down") return null;
  if (chat.ratingFollowUp === "thanks") {
    return (
      <div className="ai-chat-note muted" role="status">
        {AI_RATING_COPY.thanks}
      </div>
    );
  }
  if (chat.ratingFollowUp !== "ask") return null;

  function toggle(c: AiRatingReason) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  async function send() {
    const reasons = AI_RATING_REASONS.filter((c) => picked.has(c));
    const n = note.trim();
    setSending(true);
    try {
      await rateAiAnswer(answerId, { rating: "down", ...(reasons.length ? { reasons } : {}), ...(n ? { note: n } : {}) });
      useAiSessionStore.getState().setTurnRating(answerId, {
        rating: "down",
        ...(reasons.length ? { ratingReasons: reasons } : {}),
        ...(n ? { ratingNote: n } : {}),
        ratingFollowUp: "thanks",
      });
    } catch {
      useToastStore.getState().showToast(AI_RATING_COPY.saveFailed, "error");
      setSending(false);
    }
  }

  return (
    <>
      <div className="ai-chat-choices" role="group" aria-label={AI_RATING_COPY.reasonsPrompt}>
        <span className="muted">{AI_RATING_COPY.reasonsPrompt}</span>
        {AI_RATING_REASONS.map((c) => (
          <button key={c} type="button" className="ghost-sm" aria-pressed={picked.has(c)} onClick={() => toggle(c)}>
            {AI_RATING_REASON_LABEL[c]}
          </button>
        ))}
      </div>
      <textarea
        className="ds-select ai-chat-textarea"
        rows={2}
        maxLength={500}
        aria-label={AI_RATING_COPY.note}
        placeholder={AI_RATING_COPY.note}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="ds-actions">
        <button type="button" className="btn-primary btn-sm" disabled={sending} onClick={() => void send()}>
          {AI_RATING_COPY.send}
        </button>
        <button
          type="button"
          className="ghost-sm"
          onClick={() => useAiSessionStore.getState().setTurnRating(answerId, { rating: "down", ratingFollowUp: "skipped" })}
        >
          {AI_RATING_COPY.skip}
        </button>
      </div>
    </>
  );
}
