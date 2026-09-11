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

/** Marker stored in the pushed history entry's state so we know we own that entry. */
export const DASHBOARD_HISTORY_MARKER = "kbiDashboardEntry";

/** Parse a location.search string. Returns null when absent or not a positive integer. */
export function readDashboardIdFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get(DASHBOARD_URL_PARAM);
  if (raw === null || !/^\d+$/.test(raw)) return null; // rejects "", "12abc", "1.5", "-3"
  const id = Number(raw);
  return id > 0 ? id : null; // rejects "0"
}

/** Build a same-origin relative URL with the dashboard param set (id) or removed (null). */
export function buildDashboardUrl(
  loc: { pathname: string; search: string; hash: string },
  id: number | null,
): string {
  const params = new URLSearchParams(loc.search);
  if (id === null) params.delete(DASHBOARD_URL_PARAM);
  else params.set(DASHBOARD_URL_PARAM, String(id));
  const qs = params.toString();
  return `${loc.pathname}${qs ? `?${qs}` : ""}${loc.hash}`;
}

/** Push ONE history entry for an opened dashboard, marked as ours. */
export function openDashboardUrl(id: number): void {
  // Locked decision 3: opening pushes exactly ONE entry, marked as ours so
  // leaveDashboardUrl() knows there is something to pop.
  window.history.pushState(
    { [DASHBOARD_HISTORY_MARKER]: true },
    "",
    buildDashboardUrl(window.location, id),
  );
}

/** Strip the dashboard param from the CURRENT history entry, in place.
 *  Never pushes, never pops, never navigates. Safe to call when already clean. */
export function clearDashboardUrl(): void {
  // DLINK-V121-07: the address bar must never describe a screen the user is not on.
  // replaceState ONLY — we are correcting the CURRENT entry, not navigating and not
  // manufacturing a new one. Also drops our marker from this entry, which is correct:
  // once the param is gone the entry no longer represents an open dashboard.
  window.history.replaceState(null, "", buildDashboardUrl(window.location, null));
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
