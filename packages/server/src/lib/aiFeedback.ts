// Phase 149 (FEEDBACK-V22-01): answer ratings on ai_audit and per-user AI preferences. The note is user text: never log it, never send it to a provider.
import type Database from "better-sqlite3";
import { db } from "../db";

export const AI_RATING_REASONS = ["wrong_data", "wrong_chart", "not_what_asked", "other"] as const;
export type AiRatingReason = (typeof AI_RATING_REASONS)[number];
export type AiRating = "up" | "down";
export const AI_RATING_NOTE_MAX = 500;
export type RateResult = "ok" | "not_found" | "not_rateable";

export function rateAiAnswer(
  input: { auditId: number; username: string; rating: AiRating | null; reasons?: readonly AiRatingReason[]; note?: string; now: number },
  conn: Database.Database = db,
): RateResult {
  const down = input.rating === "down";
  const picked = down ? AI_RATING_REASONS.filter((c) => input.reasons?.includes(c)) : [];
  const note = down ? (input.note ?? "").trim() : "";
  const info = conn
    .prepare(
      `UPDATE ai_audit SET rating=@rating, rating_reasons=@reasons, rating_note=@note, rated_ts_ms=@now
       WHERE id=@id AND lower(username)=lower(@user) AND status='final' AND outcome='ok'
         AND COALESCE(kind,'ask') IN ('ask','generate')
         AND (request_id IS NULL OR (request_id NOT LIKE 'keep-%' AND request_id NOT LIKE 'mcp-%'))`,
    )
    .run({
      rating: input.rating,
      reasons: picked.length ? JSON.stringify(picked) : null,
      note: note || null,
      now: input.now,
      id: input.auditId,
      user: input.username,
    });
  if (info.changes > 0) return "ok";
  const own = conn.prepare("SELECT 1 FROM ai_audit WHERE id=? AND lower(username)=lower(?)").get(input.auditId, input.username);
  return own ? "not_rateable" : "not_found";
}

export type AiPrefs = { showRatingButtons: boolean };
export const AI_PREFS_DEFAULTS: AiPrefs = { showRatingButtons: true };

export function getAiPrefs(username: string, conn: Database.Database = db): AiPrefs {
  const row = conn.prepare("SELECT show_rating_buttons FROM ai_user_prefs WHERE username = lower(?)").get(username) as
    | { show_rating_buttons: number }
    | undefined;
  return { showRatingButtons: row ? row.show_rating_buttons === 1 : AI_PREFS_DEFAULTS.showRatingButtons };
}

export function setAiPrefs(username: string, patch: Partial<AiPrefs>, now: number, conn: Database.Database = db): AiPrefs {
  const merged: AiPrefs = { ...getAiPrefs(username, conn), ...patch };
  conn
    .prepare(
      `INSERT INTO ai_user_prefs (username, show_rating_buttons, updated_ms) VALUES (lower(@u), @s, @now)
       ON CONFLICT(username) DO UPDATE SET show_rating_buttons = excluded.show_rating_buttons, updated_ms = excluded.updated_ms`,
    )
    .run({ u: username, s: merged.showRatingButtons ? 1 : 0, now });
  return merged;
}
