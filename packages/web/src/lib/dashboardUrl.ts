/**
 * lib/dashboardUrl.ts — Phase 113 Plan 01 (DLINK-V121-01/06/07).
 *
 * Pure param read/build helpers + the three History-API writers that keep the
 * browser address bar in sync with which dashboard, if any, is open. Native
 * History API only — no router, no new dependency.
 *
 * Locked decisions (113-CONTEXT.md):
 *   - URL shape is a query param (`?dashboard=12`), never a path or hash.
 *   - Identifier is the numeric dashboard id, never a slug (names are not unique).
 *   - The app's Back IS the browser's Back: opening pushes ONE history entry;
 *     leaving pops that entry rather than pushing a second one.
 *   - The URL updates immediately on open, before widgets fetch.
 *
 * Scope fence: this module never resolves a URL into an open dashboard — reading
 * the URL to OPEN something on boot is Phase 114. Only reads live in a popstate
 * handler or an unmount cleanup (both wired in DashboardsPage.tsx, not here).
 */

/** The query-param name carrying the open dashboard's id. */
export const DASHBOARD_URL_PARAM = "dashboard";

/** Phase 117 (DSET-V122-01/02): the query-param name carrying the open dashboard's mode
 *  qualifier. THE SAME LITERAL "mode" that lib/tableUrl.ts's TABLE_MODE_PARAM uses — tableUrl.ts's
 *  own header comment predicted this ("if one is ever added elsewhere ... becomes a collision").
 *  Phase 117 IS that "elsewhere". The collision is ACCEPTED, not fixed: see clearDashboardUrl below. */
export const DASHBOARD_MODE_PARAM = "mode";

/** Marker stored in the pushed history entry's state so we know we own that entry. */
export const DASHBOARD_HISTORY_MARKER = "kbiDashboardEntry";

/** Phase 117 (DSET-V122-01/02/08). Three modes where tables have two, and note WHICH ONE is the
 *  absence-representing default:
 *    ?dashboard=12            -> "open"  (the RUNNING dashboard)
 *    ?dashboard=12&mode=view  -> "view"  (the settings/detail screen)
 *    ?dashboard=12&mode=edit  -> "edit"
 *  Tables' bare ?table=12 means VIEW. That is NOT an inconsistency to harmonise away: both follow
 *  "a bare URL opens that entity's PRIMARY screen", and a dashboard's primary screen is the running
 *  dashboard. ?dashboard=<id> has shipped, is bookmarked by real users, and is asserted by the
 *  whole Phase 113-115 suite — changing what it means would be a silent breaking change for
 *  everyone holding a link. DSET-V122-08 exists to protect exactly this. */
export type DashboardMode = "open" | "view" | "edit";

/** Phase 115 (DLINK-V121-03): the ONE definition of a well-formed dashboard id.
 *  Shared deliberately: the id now arrives from TWO untrusted sources — the URL param and
 *  the `kbi_returnTo` sessionStorage blob — and two independently-maintained shape checks
 *  drift. A type-guard (not a boolean) so callers narrow `unknown` straight to `number`. */
export function isValidDashboardId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Parse the mode qualifier. Absent-means-OPEN, and an UNRECOGNISED value (including a
 *  differently-cased "EDIT") also means open — never a failure. The id is the identity and it is
 *  valid; refusing to open a real dashboard over a typo in a secondary qualifier is worse for the
 *  user than quietly showing the entity's primary screen. Exact-match only — do NOT lowercase or trim. */
export function readDashboardModeFromSearch(search: string): DashboardMode {
  const raw = new URLSearchParams(search).get(DASHBOARD_MODE_PARAM);
  if (raw === "view") return "view";
  if (raw === "edit") return "edit";
  return "open";
}

/** Parse a location.search string. Returns null when absent or not a positive integer. */
export function readDashboardIdFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get(DASHBOARD_URL_PARAM);
  if (raw === null || !/^\d+$/.test(raw)) return null; // rejects "", "12abc", "1.5", "-3"
  const id = Number(raw);
  return isValidDashboardId(id) ? id : null; // rejects "0"
}

/** True iff the dashboard param key is present at all — INCLUDING a value that does not
 *  parse to an id ("?dashboard=abc"). Pairs with readDashboardIdFromSearch (which returns
 *  null for that case) so a caller can tell "no deep link" from "junk deep link" and strip
 *  the junk rather than leaving it in the address bar (DLINK-V121-07). Phase 114. */
export function hasDashboardParam(search: string): boolean {
  return new URLSearchParams(search).has(DASHBOARD_URL_PARAM);
}

/** Build a same-origin relative URL with the dashboard param set (id) or removed (null), and the
 *  mode param set only for "view"/"edit" — "open" is expressed by the param's ABSENCE, so the URL
 *  of an open dashboard is the short, canonical, already-shipped one. */
export function buildDashboardUrl(
  loc: { pathname: string; search: string; hash: string },
  id: number | null,
  mode: DashboardMode = "open",   // Phase 117 — DEFAULTED so every existing 2-arg call site
                                   // (3 in this module, 5 in the spec) keeps compiling AND keeps
                                   // producing the identical bare URL. DSET-V122-08.
): string {
  const params = new URLSearchParams(loc.search);
  if (id === null) {
    params.delete(DASHBOARD_URL_PARAM);
    params.delete(DASHBOARD_MODE_PARAM);
  } else {
    params.set(DASHBOARD_URL_PARAM, String(id));
    if (mode === "open") params.delete(DASHBOARD_MODE_PARAM);   // open == absence
    else params.set(DASHBOARD_MODE_PARAM, mode);
  }
  const qs = params.toString();
  return `${loc.pathname}${qs ? `?${qs}` : ""}${loc.hash}`;
}

/** Push ONE history entry for an opened dashboard, marked as ours. */
export function openDashboardUrl(id: number, mode: DashboardMode = "open"): void {
  // Locked decision 3: opening pushes exactly ONE entry, marked as ours so
  // leaveDashboardUrl() knows there is something to pop. The marker is entry-level, not
  // mode-level — unchanged by Phase 117.
  window.history.pushState(
    { [DASHBOARD_HISTORY_MARKER]: true },
    "",
    buildDashboardUrl(window.location, id, mode),
  );
}

/** Strip the dashboard param from the CURRENT history entry, in place.
 *  Never pushes, never pops, never navigates. Safe to call when already clean. */
export function clearDashboardUrl(): void {
  // DLINK-V121-07: the address bar must never describe a screen the user is not on.
  // replaceState ONLY — we are correcting the CURRENT entry, not navigating and not
  // manufacturing a new one. Also drops our marker from this entry, which is correct:
  // once the param is gone the entry no longer represents an open dashboard.
  //
  // Phase 117: this also deletes ?mode=, which lib/tableUrl.ts's TABLE_MODE_PARAM shares as the
  // SAME literal key. A hand-crafted "?dashboard=5&table=12&mode=edit" therefore loses the TABLE's
  // qualifier when the dashboard leaves. ACCEPTED, not a defect: no UI path produces that URL
  // (dashboard-wins precedence in App.tsx means only one entity ever drives navigation), and the
  // cross-module namespace check it would take to fix is more machinery than a hand-edited-URL-only
  // edge case is worth. lib/dashboardUrl.spec.ts pins today's actual behaviour so a future reader
  // sees this was noticed, not missed. lib/tableUrl.ts is NOT edited by this phase (117-RESEARCH §Q1).
  window.history.replaceState(null, "", buildDashboardUrl(window.location, null));
}

/** Phase 115 (DLINK-V121-03): put ?dashboard=<id> back on the CURRENT history entry.
 *  Needed because the OIDC success redirect returns the browser to a bare `/`
 *  (packages/server/src/index.ts:637) — the query string is gone, so after the round trip the
 *  address bar must be re-synced or it would describe the dashboard LIST while a dashboard is
 *  open (DLINK-V121-07). replaceState, NEVER pushState: the user did not navigate within the
 *  app to get here, so no history entry is manufactured (same reasoning as clearDashboardUrl).
 *  Idempotent — a no-op when the param already reads <id>. This path deliberately drops the
 *  marker — it is a post-OIDC re-sync, not a mode change. */
export function restoreDashboardUrl(id: number, mode: DashboardMode = "open"): void {
  window.history.replaceState(null, "", buildDashboardUrl(window.location, id, mode));
}

/** Phase 117 (DSET-V122-02). Change the mode qualifier on the CURRENT entry without disturbing
 *  whether that entry is "ours" (pushed from the list) or "arrived" (a fresh paste).
 *  leaveDashboardUrl()'s pop-vs-write branch must read the SAME answer afterwards as before.
 *
 *  ⚠️ `window.history.state` is passed THROUGH, deliberately. Writing `replaceState(null, ...)`
 *  would silently convert a self-opened screen into a write-instead-of-pop, losing a real history
 *  entry; writing `replaceState({[DASHBOARD_HISTORY_MARKER]: true}, ...)` would make a deep-linked
 *  arrival start popping, ejecting the user out of the application. Neither hardcoding is correct.
 *
 *  Called from TWO sites in DashboardsPage.tsx (Plan 02) — the after-Save edit->view AND
 *  DashboardDetail's own in-app Edit button (view->edit). Tables only ever needed ONE call site,
 *  because TableDetail has no Edit affordance; do not assume one site is enough here. */
export function setDashboardMode(id: number, mode: DashboardMode): void {
  window.history.replaceState(window.history.state, "", buildDashboardUrl(window.location, id, mode));
}

/** Leave the open dashboard. Pops our pushed entry if we own the current one,
 *  otherwise clears in place. Returns which branch ran. */
export function leaveDashboardUrl(): "popped" | "wrote" {
  const state = window.history.state as Record<string, unknown> | null;
  if (state && state[DASHBOARD_HISTORY_MARKER] === true) {
    // We pushed this entry — pop it, so the app's Back and the browser's Back
    // are the same action and the stack stays shallow.
    window.history.back();
    return "popped";
  }
  // No entry of ours to pop (e.g. a Phase 114 deep-link arrival). Calling
  // history.back() here would eject the user out of the application entirely,
  // so clear the param in place instead.
  clearDashboardUrl();
  return "wrote";
}
