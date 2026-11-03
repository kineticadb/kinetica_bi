// Phase 139: AI session dynamic-view names. Built ONLY on the server from (authed user, login sid, per-tab nonce, temp id, gen);
// the client never sends a name. Every DDL/DROP site must call isOwnAiDynamicViewName / parseAiDynamicViewName first.
// Shape: _kbi_ai_u<user>_s<sid8>_n<nonce8>_<abs(tempId)>[_g<gen>]  (gen 0 has no suffix). The 133 spike shape (no _n) never parses.
import { sanitizeForViewName } from "./viewNaming";

export const AI_DV_NAME_RE = /^_kbi_ai_u([A-Za-z0-9_]{1,32})_s([A-Za-z0-9]{1,8})_n([a-f0-9]{8})_(\d{1,9})(?:_g(\d{1,3}))?$/;
export type AiDvNameParts = { username: string; sid: string; nonce: string; tempId: number; gen?: number };

const bad = (): never => {
  throw new Error("bad ai view id");
};

function checkIds(nonce: string, tempId: number, gen: number): void {
  if (!/^[a-f0-9]{8}$/.test(nonce)) bad();
  if (!Number.isSafeInteger(tempId) || tempId >= 0 || Math.abs(tempId) > 999999999) bad();
  if (!Number.isInteger(gen) || gen < 0 || gen > 999) bad();
}

export function buildAiDynamicViewName(a: AiDvNameParts): string {
  const gen = a.gen ?? 0;
  checkIds(a.nonce, a.tempId, gen);
  const sid8 = a.sid.slice(0, 8);
  if (!/^[A-Za-z0-9]{1,8}$/.test(sid8)) bad();
  return `_kbi_ai_u${sanitizeForViewName(a.username)}_s${sid8}_n${a.nonce}_${Math.abs(a.tempId)}${gen > 0 ? `_g${gen}` : ""}`;
}

export function parseAiDynamicViewName(
  name: string,
): { user: string; sid8: string; nonce: string; absTempId: number; gen: number } | null {
  const m = AI_DV_NAME_RE.exec(name);
  if (!m) return null;
  return { user: m[1]!, sid8: m[2]!, nonce: m[3]!, absTempId: Number(m[4]), gen: m[5] === undefined ? 0 : Number(m[5]) };
}

export function isOwnAiDynamicViewName(name: string, who: { username: string; sid: string }): boolean {
  const p = parseAiDynamicViewName(name);
  return p !== null && p.user === sanitizeForViewName(who.username) && p.sid8 === who.sid.slice(0, 8);
}

export function aiDvJobTag(a: { nonce: string; tempId: number; gen?: number }): string {
  return `aidv-${a.nonce}-${Math.abs(a.tempId)}-g${a.gen ?? 0}`;
}
