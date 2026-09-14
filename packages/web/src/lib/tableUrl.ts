/**
 * lib/tableUrl.ts — Phase 116 Plan 01 (TLINK-V121-01/06/07).
 *
 * The TABLE sibling of lib/dashboardUrl.ts. Deliberately a SEPARATE module, not a rename and not
 * a shared factory: renaming or parameterizing dashboardUrl.ts would force import-path edits
 * across 7 spec files / 132 tests, which ROADMAP §Phase 116 criterion 6 forbids (116-RESEARCH §Q1).
 * dashboardUrl.ts is NOT touched by this phase.
 *
 * Locked decisions inherited from 113-CONTEXT.md, unchanged for tables:
 *   - Query param, never a path or hash.
 *   - Numeric id, never a name/slug.
 *   - Opening pushes exactly ONE history entry, marked as ours.
 *   - Leaving pops that entry if we own it; an arrival with NO entry of ours WRITES the list url
 *     instead, because history.back() there would eject the user out of the application.
 *
 * NEW for tables (116-CONTEXT.md §"THE ONE NEW DECISION"):
 *   - A `mode` qualifier: ?table=12 is VIEW, ?table=12&mode=edit is EDIT.
 *   - Absent-means-view, and an UNRECOGNISED mode value also means view — never a failure. The id
 *     is the identity and it is valid; refusing to open a real table over a typo in a secondary
 *     qualifier is worse for the user than quietly showing the safer of the two modes.
 *   - `create` and `list` are not linkable.
 */

/** The query-param name carrying the open table's id. */
export const TABLE_URL_PARAM = "table";

/** The query-param name carrying the open table's mode qualifier. Generic name, owned exclusively
 *  by this module today (grep confirms no other `?mode=` consumer in packages/web/src) — if one
 *  is ever added elsewhere, buildTableUrl's delete/set of this param becomes a collision. */
export const TABLE_MODE_PARAM = "mode";

/** Marker stored in the pushed history entry's state so we know we own that entry. */
export const TABLE_HISTORY_MARKER = "kbiTableEntry";

/** view = ?table=12 (param absent); edit = ?table=12&mode=edit. Absent/unrecognised -> view. */
export type TableMode = "view" | "edit";

/** The ONE definition of a well-formed table id, mirroring isValidDashboardId. The id arrives
 *  from TWO untrusted sources — the URL param and the `kbi_returnTo` sessionStorage blob — and
 *  two independently-maintained shape checks drift. A type-guard (not a boolean) so callers
 *  narrow `unknown` straight to `number`. */
export function isValidTableId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Parse a location.search string. Returns null when absent or not a positive integer. */
export function readTableIdFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get(TABLE_URL_PARAM);
  if (raw === null || !/^\d+$/.test(raw)) return null; // rejects "", "12abc", "1.5", "-3"
  const id = Number(raw);
  return isValidTableId(id) ? id : null; // rejects "0"
}

/** Parse the mode qualifier. LOCKED (116-CONTEXT §"THE ONE NEW DECISION"): absent-means-view, and
 *  an UNRECOGNISED value (including a differently-cased "EDIT") also means view — never a
 *  failure. The id is the identity and it is valid; refusing to open a real table over a typo in
 *  a secondary qualifier is worse for the user than quietly showing the safer of the two modes.
 *  Exact-match only against "edit" — do NOT lowercase or trim. */
export function readTableModeFromSearch(search: string): TableMode {
  const raw = new URLSearchParams(search).get(TABLE_MODE_PARAM);
  return raw === "edit" ? "edit" : "view";
}

/** True iff the table param key is present at all — INCLUDING a value that does not parse to an
 *  id ("?table=abc"). Pairs with readTableIdFromSearch (which returns null for that case) so a
 *  caller can tell "no deep link" from "junk deep link" and strip the junk rather than leaving it
 *  in the address bar (TLINK-V121-07). */
export function hasTableParam(search: string): boolean {
  return new URLSearchParams(search).has(TABLE_URL_PARAM);
}

/** Build a same-origin relative URL with the table param set (id) or removed (null), and the mode
 *  param set only for "edit" — view is expressed by the param's ABSENCE, so the URL of a view is
 *  the short, canonical one. */
export function buildTableUrl(
  loc: { pathname: string; search: string; hash: string },
  id: number | null,
  mode: TableMode = "view",
): string {
  const params = new URLSearchParams(loc.search);
  if (id === null) {
    params.delete(TABLE_URL_PARAM);
    params.delete(TABLE_MODE_PARAM);
  } else {
    params.set(TABLE_URL_PARAM, String(id));
    if (mode === "edit") params.set(TABLE_MODE_PARAM, "edit");
    else params.delete(TABLE_MODE_PARAM);
  }
  const qs = params.toString();
  return `${loc.pathname}${qs ? `?${qs}` : ""}${loc.hash}`;
}

/** Push ONE history entry for an opened table, marked as ours. */
export function openTableUrl(id: number, mode: TableMode): void {
  // Locked decision: opening pushes exactly ONE entry, marked as ours so leaveTableUrl() knows
  // there is something to pop.
  window.history.pushState(
    { [TABLE_HISTORY_MARKER]: true },
    "",
    buildTableUrl(window.location, id, mode),
  );
}

/** Strip the table + mode params from the CURRENT history entry, in place.
 *  Never pushes, never pops, never navigates. Safe to call when already clean. */
export function clearTableUrl(): void {
  // TLINK-V121-06: the address bar must never describe a screen the user is not on.
  // replaceState ONLY — we are correcting the CURRENT entry, not navigating and not
  // manufacturing a new one. Also drops our marker from this entry, which is correct: once the
  // param is gone the entry no longer represents an open table.
  window.history.replaceState(null, "", buildTableUrl(window.location, null));
}

/** Put ?table=<id>[&mode=edit] back on the CURRENT history entry. Needed because the OIDC success
 *  redirect returns the browser to a bare `/` — the query string is gone, so after the round trip
 *  the address bar must be re-synced or it would describe the table LIST while a table is open.
 *  replaceState, NEVER pushState: the user did not navigate within the app to get here, so no
 *  history entry is manufactured (same reasoning as clearTableUrl). Idempotent. */
export function restoreTableUrl(id: number, mode: TableMode): void {
  window.history.replaceState(null, "", buildTableUrl(window.location, id, mode));
}

/** The ONE writer with no dashboard analogue (116-RESEARCH Pitfall 3). Changes the mode qualifier
 *  on the CURRENT entry — e.g. the edit->view transition after a Save — WITHOUT disturbing
 *  whether that entry is "ours" (pushed from the list) or "arrived" (a fresh
 *  `?table=12&mode=edit` paste). leaveTableUrl()'s pop-vs-write branch must see the SAME answer
 *  after a Save as it would have before it. Writing `replaceState(null, ...)` would silently
 *  convert a self-opened edit into a write-instead-of-pop (losing a real history entry); writing
 *  `replaceState({[TABLE_HISTORY_MARKER]: true}, ...)` would make a deep-linked arrival start
 *  popping, ejecting the user out of the app. Neither hardcoding is correct — it must PRESERVE
 *  whatever `window.history.state` already is. */
export function setTableMode(id: number, mode: TableMode): void {
  window.history.replaceState(window.history.state, "", buildTableUrl(window.location, id, mode));
}

/** Leave the open table. Pops our pushed entry if we own the current one, otherwise clears in
 *  place. Returns which branch ran. */
export function leaveTableUrl(): "popped" | "wrote" {
  const state = window.history.state as Record<string, unknown> | null;
  if (state && state[TABLE_HISTORY_MARKER] === true) {
    // We pushed this entry — pop it, so the app's Back and the browser's Back are the same
    // action and the stack stays shallow.
    window.history.back();
    return "popped";
  }
  // No entry of ours to pop (e.g. a deep-link arrival). Calling history.back() here would eject
  // the user out of the application entirely, so clear the param in place instead.
  clearTableUrl();
  return "wrote";
}
