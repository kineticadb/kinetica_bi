/**
 * Phase 15 (LIFE-V13-02): Kinetica error-shape helpers.
 *
 * isViewNotFoundError detects the Kinetica "view not found" error string
 * captured by Phase 13 spike S3 (verbatim form):
 *   "SqlEngine: Object '<view-name>' not found (S/SDc:1513)"
 * at HTTP 400. The error reaches the client via runSql / throwForStatus
 * (src/api/client.ts:63-79) — HTTP 400 isn't mapped to a typed
 * error class, so we inspect err.message. throwForStatus's body.error
 * extraction populates message with the Kinetica string verbatim.
 *
 * Pattern lock (.planning/STATE.md Phase 13 lock + .planning/phases/15-chart-filtering/15-RESEARCH.md § Pattern 4):
 *   - Substring match: /SqlEngine: Object '[^']+' not found/i (case-insensitive)
 *   - AND substring match: "S/SDc:1513" (Kinetica internal error code — exact)
 *
 * Both must hold to avoid false positives on unrelated SqlEngine errors that
 * happen to mention "not found" in user-supplied table names.
 */

const VIEW_NOT_FOUND_RE = /SqlEngine: Object '[^']+' not found/i;
const KINETICA_VIEW_NOT_FOUND_CODE = "S/SDc:1513";

export const isViewNotFoundError = (err: unknown): boolean => {
  if (!err || typeof err !== "object") return false;
  const message = (err as { message?: unknown }).message;
  if (typeof message !== "string") return false;
  return VIEW_NOT_FOUND_RE.test(message) && message.includes(KINETICA_VIEW_NOT_FOUND_CODE);
};
