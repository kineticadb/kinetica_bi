/**
 * hooks/useDeepLinkTable.ts — Phase 116 Plan 02 (TLINK-V121-02/04/07).
 *
 * The TABLE sibling of hooks/useDeepLinkDashboard.ts. A deliberately SEPARATE file, not a
 * parameterization of the dashboard hook: the "opened" payload shape differs — it carries a
 * `mode` ("view" | "edit") the dashboard hook has no equivalent for — so a generic shared core
 * would need a second type parameter for "extra opened-state data" on top of the union itself.
 * That is more machinery than the ~55 lines of genuinely simple logic being protected are worth
 * (116-RESEARCH §Q1). useDeepLinkDashboard.ts and its spec are NOT edited by this phase.
 *
 * WHY resolution goes through the table list + find, and NOT a fetch by id:
 * `GET /api/tables/:id` DOES exist (packages/server/src/index.ts:2352) — unlike dashboards,
 * which have no per-id route at all — but it is deliberately left unused here. The existing
 * client wrapper for that route (api/client.ts) has zero call sites anywhere in packages/web/src
 * before or after this file. The list+find shape gives the found / resolved-but-absent /
 * rejected-promise trichotomy for free, exactly as it does for useDeepLinkDashboard; reproducing
 * that through a per-id fetch would require inspecting the HTTP status before throwForStatus
 * flattens it into a generic Error (404 is not a distinct error class there — only 401/403/502
 * are, api/client.ts:100-121), i.e. brand-new, uninherited error-classification code for a
 * marginal saving.
 *
 * THE NON-LEAK FINDING, condensed (116-CONTEXT "THE ONE NEW DECISION" / "non-leak" sections):
 * 114-CONTEXT's combined "deleted, or you may not have access" wording exists because there is
 * no GET /api/dashboards/:id and GET /api/dashboards is permission-filtered server-side, making
 * a missing dashboard id genuinely ambiguous between deleted and not-permitted. That reasoning
 * does NOT hold for tables: `GET /api/tables` and `GET /api/tables/:id` carry no permission
 * middleware (both sit behind the app-wide `requireAuth` only, index.ts:641), and there is no
 * `DATASETS_VIEW` permission or per-table ACL anywhere in packages/server/src — the only table
 * permission, `DATASETS_MANAGE`, gates writes exclusively. "Not permitted" is therefore NOT a
 * reachable state for tables today; every id either exists (any authenticated user may view it)
 * or does not (a real 404). The unavailable message below is narrowed to the "deleted" clause
 * alone for this reason — copying the dashboard's two-clause wording would copy Phase 114's
 * words while discarding the reasoning that justified them. If per-table permissions are ever
 * added, this copy must change alongside them.
 */
import { useEffect, useRef, useState } from "react";
import { listTables, type TableDto } from "../api/client";
import { useAuthStore } from "../store/auth";
import {
  clearTableUrl,
  hasTableParam,
  isValidTableId,
  readTableIdFromSearch,
  readTableModeFromSearch,
  type TableMode,
} from "../lib/tableUrl";

export type DeepLinkTableState =
  | { status: "none" }
  | { status: "pending"; id: number; mode: TableMode }
  | { status: "opened"; table: TableDto; mode: TableMode }
  | { status: "unavailable" }
  | { status: "error" };

/** Narrowed for tables — see the header. Only the "deleted" case is reachable today: neither
 *  /api/tables nor /api/tables/:id is permission-scoped, so "not permitted" cannot occur. If a
 *  per-table permission is ever introduced, this message must be revisited alongside it. */
export const DEEP_LINK_TABLE_UNAVAILABLE_MESSAGE =
  "This table isn't available — it may have been deleted.";

/**
 * @param storedTable Phase 116's analogue of useDeepLinkDashboard's `storedId`: a `{ id, mode }`
 *   pair that is NOT in the URL, recovered by App.tsx from the `kbi_returnTo` sessionStorage blob
 *   after an OIDC round trip destroyed the query string. Consumed at MOUNT ONLY, in the
 *   initializer below — App reads storage in its own mount-time initializer, so the value is
 *   already present on App's FIRST render. Accepting it later would mean App had already
 *   rendered the tables LIST for a frame, which is the flash TLINK-V121-02 forbids. The hook
 *   deliberately does NOT read sessionStorage itself: App.tsx owns the ONE `kbi_returnTo` parser,
 *   and the hook only ever receives a plain validated { id, mode } pair.
 */
export function useDeepLinkTable(
  storedTable?: { id: number; mode: TableMode } | null,
): DeepLinkTableState {
  const authStatus = useAuthStore((s) => s.status);

  // Read the boot URL ONCE, in a useState initializer, so it is captured before any effect
  // (ours or any other) can mutate it.
  const [state, setState] = useState<DeepLinkTableState>(() => {
    const id = readTableIdFromSearch(window.location.search);
    if (id !== null) {
      return { status: "pending", id, mode: readTableModeFromSearch(window.location.search) };
    }
    // Present but unparseable ("?table=abc"): NOT a deep link, but strip it so the address bar
    // matches the list that is about to render (TLINK-V121-06).
    if (hasTableParam(window.location.search)) clearTableUrl();
    // URL first, storage second — the same precedence Phase 114 established for dashboards.
    if (storedTable && isValidTableId(storedTable.id)) {
      return { status: "pending", id: storedTable.id, mode: storedTable.mode };
    }
    return { status: "none" };
  });

  // StrictMode double-invokes effects on mount; the ref keeps listTables to one call.
  const startedRef = useRef(false);

  useEffect(() => {
    if (state.status !== "pending") return;
    // Not authenticated yet (bootstrapping, or logged out): stay pending and touch nothing.
    // The logged-out arrival is Phase 115's pattern; the param must survive for it.
    if (authStatus !== "authenticated") return;
    if (startedRef.current) return;
    startedRef.current = true;
    const pendingId = state.id;
    const pendingMode = state.mode;
    listTables()
      .then((list) => {
        const match = list.find((t) => t.id === pendingId);
        if (match) {
          // Success: leave ?table=<id>[&mode=edit] exactly where it is — it describes the screen.
          setState({ status: "opened", table: match, mode: pendingMode });
          return;
        }
        clearTableUrl();
        setState({ status: "unavailable" });
      })
      .catch(() => {
        // Mirrors useDeepLinkDashboard's catch — a 401/logout mid-flight must NOT strip the
        // param; a later re-auth consumes it. Re-arm so a same-tab re-auth retries.
        if (useAuthStore.getState().status !== "authenticated") {
          startedRef.current = false;
          return;
        }
        clearTableUrl();
        setState({ status: "error" });
      });
  }, [state, authStatus]);

  return state;
}
