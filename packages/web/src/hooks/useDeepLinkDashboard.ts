/**
 * hooks/useDeepLinkDashboard.ts — Phase 114 Plan 01 (DLINK-V121-02/04/05).
 *
 * Turns the boot URL's ?dashboard=<id> into a five-state machine App.tsx can render
 * without any further logic.
 *
 * WHY the resolution is a LIST lookup and not a fetch-by-id: there is no
 * GET /api/dashboards/:id route, deliberately. GET /api/dashboards is permission-filtered
 * server-side (server/src/index.ts:783) and every per-dashboard sub-resource returns an
 * identical 404 for "deleted" and for "not permitted" (index.ts:879/918/949/1043) — v1.10's
 * non-leak design. An id absent from the list is therefore genuinely ambiguous, which is why
 * there is ONE "unavailable" outcome and ONE message, not two.
 */
import { useEffect, useRef, useState } from "react";
import { listDashboards, type DashboardDto } from "../api/client";
import { useAuthStore } from "../store/auth";
import {
  clearDashboardUrl,
  hasDashboardParam,
  isValidDashboardId,
  readDashboardIdFromSearch,
} from "../lib/dashboardUrl";

export type DeepLinkState =
  | { status: "none" }
  | { status: "pending"; id: number }
  | { status: "opened"; dashboard: DashboardDto }
  | { status: "unavailable" }
  | { status: "error" };

/** The ONE combined message. Deliberately does not say which of the two reasons applies —
 *  saying so would leak which dashboard ids exist (ROADMAP Phase 114 criterion 3). */
export const DEEP_LINK_UNAVAILABLE_MESSAGE =
  "This dashboard isn't available — it may have been deleted, or you may not have access.";

/**
 * @param storedId Phase 115 (DLINK-V121-03): a dashboard id that is NOT in the URL, recovered by
 *   App.tsx from the `kbi_returnTo` sessionStorage blob after an OIDC round trip destroyed the
 *   query string. Consumed at MOUNT ONLY, in the initializer below — App reads storage in its own
 *   mount-time `useState` initializer, so the value is already present on App's FIRST render.
 *   Accepting it later would mean App had already rendered the dashboard LIST for a frame, which
 *   is the flash ROADMAP §Phase 114 criterion 1 forbids. The hook deliberately does NOT read
 *   sessionStorage itself: App.tsx owns the ONE `kbi_returnTo` parser (ROADMAP §Phase 115
 *   criterion 2 — one mechanism), and the hook only ever receives a plain validated number.
 */
export function useDeepLinkDashboard(storedId?: number | null): DeepLinkState {
  const authStatus = useAuthStore((s) => s.status);

  // Read the boot URL ONCE, in a useState initializer, so it is captured before any effect
  // (ours or Phase 113's) can mutate it.
  const [state, setState] = useState<DeepLinkState>(() => {
    const id = readDashboardIdFromSearch(window.location.search);
    if (id !== null) return { status: "pending", id };
    // Present but unparseable ("?dashboard=abc"): NOT a deep link, but strip it so the
    // address bar matches the list that is about to render (DLINK-V121-07).
    if (hasDashboardParam(window.location.search)) clearDashboardUrl();
    // URL first, storage second: a URL the user actually loaded is the fresher intent
    // (the same precedence Phase 114 established). Post-OIDC there is no URL param at all,
    // so in practice these two never both hold.
    if (isValidDashboardId(storedId)) return { status: "pending", id: storedId };
    return { status: "none" };
  });

  // StrictMode double-invokes effects on mount; the ref keeps listDashboards to one call.
  const startedRef = useRef(false);

  useEffect(() => {
    if (state.status !== "pending") return;
    // Not authenticated yet (bootstrapping, or logged out): stay pending and touch nothing.
    // The logged-out arrival is Phase 115's; the param must survive for it.
    if (authStatus !== "authenticated") return;
    if (startedRef.current) return;
    startedRef.current = true;
    const pendingId = state.id;
    listDashboards()
      .then((list) => {
        const match = list.find((d) => d.id === pendingId);
        if (match) {
          // Success: leave ?dashboard=<id> exactly where it is — it describes the screen.
          setState({ status: "opened", dashboard: match });
          return;
        }
        clearDashboardUrl();
        setState({ status: "unavailable" });
      })
      .catch(() => {
        // Mirrors DashboardsPage.tsx:633 — a 401/logout mid-flight must NOT strip the param;
        // Phase 115 consumes it after re-auth. Re-arm so a same-tab re-auth retries.
        if (useAuthStore.getState().status !== "authenticated") {
          startedRef.current = false;
          return;
        }
        clearDashboardUrl();
        setState({ status: "error" });
      });
  }, [state, authStatus]);

  return state;
}
