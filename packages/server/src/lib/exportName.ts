// Phase 131 (EXPRT-V126-08): display name (stored in options_json, shown in the UI) vs filename base (Content-Disposition).
// Why each filename rule: content-disposition@0.5.4 calls path.basename() on the name (so "a/b" would silently
// download as "b"); CR/LF/NUL would be percent-encoded into filename*; bidi overrides can spoof the extension;
// trailing dots are stripped by Windows.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const BIDI = /[‎‏‪-‮⁦-⁩﻿]/g;
const RESERVED = /[\/\\:*?"<>|]/g;
const WIN_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const cap = (s: string, n: number) => Array.from(s).slice(0, n).join("");

export const EXPORT_NAME_MAX = 200; // display name, code points
export const EXPORT_FILE_BASE_MAX = 150; // filename base, code points (room for .csv.gz)

export function sanitizeExportName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = cap(raw.replace(BIDI, "").replace(CONTROL, " ").replace(/\s+/g, " ").trim(), EXPORT_NAME_MAX).trim();
  return s === "" ? undefined : s;
}

export function exportFileBase(name: string | null | undefined): string | undefined {
  if (typeof name !== "string") return undefined;
  const trimEnds = (x: string) => x.replace(/^[.\s]+|[.\s]+$/g, "");
  let s = name.normalize("NFC").replace(BIDI, "").replace(CONTROL, "-").replace(RESERVED, "-").replace(/\s+/g, " ");
  s = trimEnds(s).replace(/\.csv(\.gz)?$/i, "");
  s = trimEnds(cap(trimEnds(s), EXPORT_FILE_BASE_MAX));
  if (WIN_DEVICE.test(s)) s += "_";
  return s === "" ? undefined : s;
}
