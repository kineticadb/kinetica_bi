// Phase 149 (FEEDBACK-V22-01): rate your own AI answer; per-user AI preferences.
// Not gated on AI being configured: rows outlive config. Never log or echo the request body (the note is user text).
import type { Express, Request } from "express";
import { z } from "zod/v4";
import type { AuthedRequest } from "./auth";
import { requirePermission } from "./rbac";
import { PERMISSIONS } from "./lib/permissions";
import { AI_RATING_NOTE_MAX, AI_RATING_REASONS, getAiPrefs, rateAiAnswer, setAiPrefs } from "./lib/aiFeedback";

const usernameOf = (req: Request): string => (req as AuthedRequest).user!.creds.username;

const RateBody = z
  .object({
    rating: z.enum(["up", "down"]).nullable(),
    reasons: z
      .array(z.enum(AI_RATING_REASONS))
      .max(AI_RATING_REASONS.length)
      .refine((a) => new Set(a).size === a.length)
      .optional(),
    note: z.string().max(AI_RATING_NOTE_MAX).optional(),
  })
  .strict()
  .refine((b) => b.rating === "down" || (b.reasons === undefined && b.note === undefined));
const PrefsBody = z
  .object({ showRatingButtons: z.boolean(), approveFirst: z.boolean() })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0);

export function registerAiFeedbackRoutes(app: Express): void {
  app.put("/api/ai/answers/:id/rating", ...requirePermission(PERMISSIONS.AI_USE), (req, res) => {
    const badReq = () => res.status(400).json({ error: "Invalid rating.", code: "AI_RATE_BAD_REQUEST" });
    const idRaw = String(req.params.id);
    if (!/^[1-9]\d{0,15}$/.test(idRaw)) return badReq();
    const p = RateBody.safeParse(req.body);
    if (!p.success) return badReq();
    const result = rateAiAnswer({
      auditId: Number(idRaw),
      username: usernameOf(req),
      rating: p.data.rating,
      reasons: p.data.reasons,
      note: p.data.note,
      now: Date.now(),
    });
    if (result === "not_found") return res.status(404).json({ error: "Answer not found.", code: "AI_ANSWER_NOT_FOUND" });
    if (result === "not_rateable") return res.status(409).json({ error: "This answer can't be rated.", code: "AI_NOT_RATEABLE" });
    return res.json({ rating: p.data.rating });
  });

  app.get("/api/ai/prefs", ...requirePermission(PERMISSIONS.AI_USE), (req, res) => {
    res.json(getAiPrefs(usernameOf(req)));
  });

  app.put("/api/ai/prefs", ...requirePermission(PERMISSIONS.AI_USE), (req, res) => {
    const p = PrefsBody.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: "Invalid preferences.", code: "AI_PREFS_BAD_REQUEST" });
    return res.json(setAiPrefs(usernameOf(req), p.data, Date.now()));
  });
}
