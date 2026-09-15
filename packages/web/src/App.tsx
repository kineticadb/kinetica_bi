import { useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import DashboardsPage from "./components/DashboardsPage";
import DatasetsPage from "./components/DatasetsPage";
import LoginPage from "./components/LoginPage";
import Toast from "./components/Toast";
import { UsersPage } from "./components/UsersPage";
import { RolesPage } from "./components/RolesPage";
import { ProfilePage } from "./components/ProfilePage";
import { useAuthStore } from "./store/auth";
import { useFilterStore } from "./store/filterStore";
import { useFilterViewStore } from "./store/filterViewStore";
import { useInfoSelectionStore } from "./store/infoSelectionStore";
import { useLastInfoClickContextStore } from "./store/lastInfoClickContextStore";
import { useSpatialFilterStore } from "./store/spatialFilterStore";
import { useDynamicViewStore } from "./store/dynamicViewStore";
import { initWmsCapabilities } from "./store/wmsCapabilities";
import { useBrandStore } from "./store/brandStore";
import { BrandStyleInjector } from "./components/BrandStyleInjector";
import { BrandingSettingsPage } from "./components/settings/BrandingSettingsPage";
import { brandPageGuard } from "./components/settings/brandPageGuard";
import { UNAUTHORIZED_EVENT, PERMISSION_DENIED_EVENT, fetchMe, dropFilterView, dropDynamicView, dropCombinationView, listUsers } from "./api/client";
import { useFilterCombinationStore } from "./store/filterCombinationStore";
import { useMapViewportSyncStore } from "./store/mapViewportSyncStore";
import { useFilterHighlightStore } from "./store/filterHighlightStore";
import { useMapCurrentViewStore } from "./store/mapCurrentViewStore";
import { PERMISSIONS } from "./lib/permissions";
import { useDeepLinkDashboard, DEEP_LINK_UNAVAILABLE_MESSAGE } from "./hooks/useDeepLinkDashboard";  // Phase 114 (DLINK-V121-02/04/05)
import { isValidDashboardId, clearDashboardUrl, hasDashboardParam, restoreDashboardUrl } from "./lib/dashboardUrl";  // Phase 115 (DLINK-V121-03)
import { useDeepLinkTable, DEEP_LINK_TABLE_UNAVAILABLE_MESSAGE } from "./hooks/useDeepLinkTable";  // Phase 116 (TLINK-V121-02/04)
import { hasTableParam, clearTableUrl, restoreTableUrl, isValidTableId, type TableMode } from "./lib/tableUrl";  // Phase 116

type Page = "dashboards" | "datasets" | "settings" | "users" | "roles" | "profile" | "branding";

// Phase 7 (UX-06 / TS-14): return-to-page after OIDC re-auth.
// Storage shape — top-level page + dashboard view mode are sufficient (per CONTEXT.md;
// deep-link state inside dashboards is OUT OF SCOPE for v1.1).
type ReturnTo = {
  page?: Page;
  dashboardViewMode?: string;
  // Phase 115 (DLINK-V121-03): the dashboard a logged-out visitor's link pointed at. Written ONLY
  // by handleSignInCommit below, because the OIDC round trip destroys window.location.search
  // (server redirects to a bare `/`). Extending THIS shape rather than adding a second key is
  // locked by ROADMAP §Phase 115 criterion 2. Validated on read with the same positive-integer
  // predicate the URL path uses — an id out of sessionStorage is attacker-controllable in exactly
  // the sense the `page` field already is (App.spec.tsx:180 proves the page allow-list rejects junk).
  dashboardId?: number;
  // Phase 116 (TLINK-V121-03): the table a logged-out visitor's link pointed at, and which of the
  // two screens it named. Written ONLY by handleSignInCommit below, for the same reason dashboardId
  // is: the OIDC round trip destroys window.location.search (the server redirects to a bare `/`).
  // These extend the SAME key — ROADMAP §Phase 116 criterion 5 forbids a second one. Validated on
  // read with the same positive-integer predicate the URL path uses.
  tableId?: number;
  tableMode?: "view" | "edit";
};

const RETURN_TO_KEY = "kbi_returnTo";
const SIDEBAR_COLLAPSED_KEY = "kbi_sidebarCollapsed";

/** Phase 115 (DLINK-V121-03): read ONLY the pending dashboard id out of kbi_returnTo, WITHOUT
 *  consuming it. The single-use clear stays owned by the restore effect below — this is a second
 *  read of the SAME key in the SAME module, not a second mechanism.
 *
 *  Read at MOUNT (a useState initializer), not in an effect: useDeepLinkDashboard consumes the
 *  value in its own mount-time initializer, so it must be present on App's FIRST render. An
 *  effect would arrive one commit late, by which time App would already have rendered the
 *  dashboard LIST — the flash ROADMAP §Phase 114 criterion 1 forbids.
 *
 *  "Elsewhere wins" is enforced structurally here too: an id is honoured only alongside page
 *  "dashboards" (or no page at all). handleSignInCommit always writes the pair; any other
 *  pairing is hand-crafted storage and is rejected. */
function readPendingDashboardId(): number | null {
  try {
    const raw = sessionStorage.getItem(RETURN_TO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReturnTo;
    if (parsed.page !== undefined && parsed.page !== "dashboards") return null;
    return isValidDashboardId(parsed.dashboardId) ? parsed.dashboardId : null;
  } catch {
    // Corrupt JSON, disabled storage, unknown shape — no pending link.
    return null;
  }
}

/** Phase 116 (TLINK-V121-03): the table sibling of readPendingDashboardId, above. Read ONLY —
 *  the single-use clear stays owned by the restore effect below, a second read of the SAME key
 *  in the SAME module, not a second mechanism. Read at MOUNT for the identical reason: an effect
 *  would arrive one commit late, after the tables LIST had already rendered for a frame. */
function readPendingTable(): { id: number; mode: TableMode } | null {
  try {
    const raw = sessionStorage.getItem(RETURN_TO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReturnTo;
    // STRICTER than readPendingDashboardId, deliberately: that one tolerates an ABSENT page,
    // because "dashboards" is the app's default landing page so absent-means-dashboards is a fair
    // reading. "datasets" is NOT the default, so an absent page can never mean it. Anything other
    // than an explicit "datasets" is hand-crafted storage and is rejected.
    if (parsed.page !== "datasets") return null;
    if (!isValidTableId(parsed.tableId)) return null;
    // Same absent-or-unrecognised-means-view rule the URL reader uses (116-CONTEXT's one new decision).
    const mode: TableMode = parsed.tableMode === "edit" ? "edit" : "view";
    return { id: parsed.tableId, mode };
  } catch {
    return null;
  }
}

const App = () => {
  const [page, setPage] = useState<Page>("dashboards");
  const [dashboardViewMode, setDashboardViewMode] = useState("list");
  // Sidebar collapse — persisted across reloads. Default expanded.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    // Drive the grid template via a CSS variable on :root so the sidebar's
    // width and the main-column's `1fr` stay in sync without prop-drilling.
    document.documentElement.style.setProperty(
      "--sidebar-width",
      sidebarCollapsed ? "56px" : "212px",
    );
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
    } catch {
      // ignore quota / private-mode errors — state still persists in memory
    }
  }, [sidebarCollapsed]);
  // USERS-V18-04: onboarding banner state — count of non-bootstrap unassigned users + dismiss flag.
  const [unassignedCount, setUnassignedCount] = useState<number | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const markUnauthenticated = useAuthStore((s) => s.markUnauthenticated);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  // Phase 115 (DLINK-V121-03): a dashboard id recovered from kbi_returnTo after an OIDC round
  // trip, read once at mount so the hook has it on the FIRST render (no list flash).
  const [pendingDashboardIdFromStorage] = useState<number | null>(() => readPendingDashboardId());
  // Phase 114 (DLINK-V121-02/04/05): the boot URL's ?dashboard=<id>, as a resolved state machine.
  const deepLink = useDeepLinkDashboard(pendingDashboardIdFromStorage);
  const [deepLinkBannerDismissed, setDeepLinkBannerDismissed] = useState(false);
  // Consumed-ONCE handoff. DashboardsPage reads initialOpenDashboard in its mount-time useState
  // initializer, so the value must be present during that render — hence a ref read in render
  // rather than state set in an effect (state would arrive one commit too late and the LIST
  // would mount first, which is exactly the flash criterion 1 forbids).
  // The ref flips immediately afterwards so that navigating away (Datasets) and back to
  // Dashboards remounts the page on the LIST, rather than silently re-opening the deep link.
  const deepLinkConsumedRef = useRef(false);
  // Phase 115: did the session expire in THIS document? Distinguishes "the ReturnTo sitting in
  // storage was captured by the expiry that just happened here" (its page is the MORE RECENT
  // intent — do not clobber it) from "a ReturnTo left over from a previous document, after which
  // the user loaded a fresh URL" (the URL is then the more recent intent). Encodes 115-CONTEXT.md's
  // "whichever signal is the more recent expression of intent wins" WITHOUT a clock — the locked
  // decision is single-use, no TTL, no timestamp.
  const expiredHereRef = useRef(false);
  // Phase 115 (DLINK-V121-03): a ReturnTo page OTHER than "dashboards" was restored, so the
  // expiry capture is the more recent intent and the URL's ?dashboard= is stale. Read by the
  // deep-link effect below and by the banner render, both of which run strictly LATER (the
  // restore effect is synchronous on the status transition; deep-link resolution needs an
  // awaited listDashboards()). A ref, not state: it must be readable during the SAME render
  // in which deepLink first resolves, exactly like deepLinkConsumedRef at :87.
  const returnToWonElsewhereRef = useRef(false);
  const initialOpenDashboard =
    deepLink.status === "opened" && !deepLinkConsumedRef.current ? deepLink.dashboard : undefined;
  // Flip gated on page === "dashboards" too (Rule 1 fix, see SUMMARY): a ReturnTo restore to a
  // DIFFERENT page (e.g. "roles") can still be active in the render where deepLink first
  // resolves to "opened" — DashboardsPage has not mounted yet on that render, so flipping the
  // ref there would burn the one-shot handoff before anyone consumed it. Gating on `page` too
  // defers the flip to the render where DashboardsPage actually receives the value.
  useEffect(() => {
    if (initialOpenDashboard && page === "dashboards") deepLinkConsumedRef.current = true;
  }, [initialOpenDashboard, page]);

  // Phase 116 (TLINK-V121-03): a table id recovered from kbi_returnTo after an OIDC round trip,
  // read once at mount so the hook has it on the FIRST render (no list flash) — mirrors
  // pendingDashboardIdFromStorage above.
  const [pendingTableFromStorage] = useState<{ id: number; mode: TableMode } | null>(() => readPendingTable());
  // Phase 116 (TLINK-V121-02/04): the boot URL's ?table=<id>[&mode=edit], as a resolved state
  // machine.
  const deepLinkTable = useDeepLinkTable(pendingTableFromStorage);
  const [deepLinkTableBannerDismissed, setDeepLinkTableBannerDismissed] = useState(false);
  // Parallel one-shot refs, NOT a reuse of the dashboard ones. Sharing a single consumed-ref between
  // two independent entities would let whichever link resolves FIRST permanently suppress the other's
  // otherwise-valid deep link for the rest of the session (116-RESEARCH §Q4). Two refs, cheaply.
  const tableDeepLinkConsumedRef = useRef(false);
  // Written by the Phase 7 ReturnTo restore effect in Plan 05; read here from the start so the
  // precedence contract is declared in one place.
  const tableReturnToWonElsewhereRef = useRef(false);
  const tableDeepLinkReady = deepLinkTable.status === "opened" && !tableDeepLinkConsumedRef.current;
  const initialOpenTable = tableDeepLinkReady
    ? { table: deepLinkTable.table, mode: deepLinkTable.mode }
    : undefined;
  // Flip gated on page === "datasets" too, for the same reason the dashboard one is: a ReturnTo
  // restore to a DIFFERENT page can still be active in the render where deepLinkTable first resolves,
  // and DatasetsPage would not have mounted yet — flipping there would burn the handoff before
  // anyone consumed it.
  useEffect(() => {
    if (tableDeepLinkReady && page === "datasets") tableDeepLinkConsumedRef.current = true;
  }, [tableDeepLinkReady, page]);

  useEffect(() => {
    bootstrap();
    // Fire brand bootstrap in parallel with auth — brand fetch is unauthenticated so it
    // must NOT wait for auth to complete (login page needs brand before auth resolves).
    // Imperative getState() call (not a hook selector) avoids adding a dep that would
    // re-fire on every store update — mirrors the initWmsCapabilities() pattern below.
    useBrandStore.getState().bootstrap();
  }, [bootstrap]);

  // window.focus refetch — picks up brand changes in other tabs that missed BroadcastChannel
  // (suspended/background tabs). Gated on hasLoaded to avoid double-bootstrap on initial load
  // (focus fires on first page load; at that point hasLoaded is still false).
  useEffect(() => {
    const onFocus = () => {
      if (useBrandStore.getState().hasLoaded) useBrandStore.getState().bootstrap();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Phase 9 FILT-01 + Phase 15 LIFE-V13-03 lifecycle: on logout / session expiry, fire-and-forget
  // DROPs for every active server-side filter view, then clear BOTH client stores.
  // Filter chips can encode sensitive selections (e.g., customer_id = 12345); view names contain
  // the user/session/dashboard tuple — must NOT survive a session boundary on a shared computer.
  // Defense-in-depth alongside the dashboard-unmount reset in DashboardsPage and the 5-min Kinetica TTL.
  useEffect(() => {
    if (status === "unauthenticated") {
      // LIFE-V13-03: snapshot active views BEFORE reset so the loop can read entry.dashboardId.
      const views = useFilterViewStore.getState().views;
      for (const tableIdStr of Object.keys(views)) {
        const tableId = Number(tableIdStr);
        const entry = views[tableId];
        // Fire-and-forget — errors swallowed (V13-P-12 lock; user is logging out, nothing to surface).
        // entry.dashboardId is populated by Plan 15-02's FilterViewEntry schema extension.
        dropFilterView({ dashboardId: entry.dashboardId, tableId }).catch(() => {});
      }
      useFilterViewStore.getState().reset();
      useFilterStore.getState().reset();
      // Phase 20 STORE-V14-04: third reset alongside the canonical two-store block.
      // No fire-and-forget DROP loop — info-selection store is session-only (STORE-V14-02);
      // no server-side resource to clean up.
      useInfoSelectionStore.getState().reset();
      // Plan 23-02 (CARD-V14-02): fourth reset — last-info-click context store.
      // Pitfall 1 lock (23-RESEARCH.md): stale dashboard-A click coords MUST NOT survive a
      // logout/session boundary. Session-only store; no DROP loop needed.
      useLastInfoClickContextStore.getState().reset();
      // Phase 27 STORE-V15-04: fifth reset — spatial filter store.
      // Session-only shapes; NO server-side DROP loop needed (mirrors infoSelectionStore +
      // lastInfoClickContextStore pattern, NOT filterViewStore's view-DROP snapshot loop).
      useSpatialFilterStore.getState().reset();
      // Phase 33 DV-V16-07 (6th store): snapshot materialized dynamic views BEFORE
      // reset so the loop can read entry IDs. Only `status === "materialized"` entries
      // have a live Kinetica view to drop — pending/error/over_threshold have no
      // server resource. Fire-and-forget with .catch(()=>{}) — never blocks logout
      // on network latency (V13-P-12 carry-forward).
      const dynamicViews = useDynamicViewStore.getState().views;
      for (const idStr of Object.keys(dynamicViews)) {
        const dvId = Number(idStr);
        if (dynamicViews[dvId]?.status === "materialized") {
          dropDynamicView(dvId).catch(() => {});
        }
      }
      useDynamicViewStore.getState().reset();
      // Phase 89 (COMBO-V118-02): 9th store — combination-view registry. Snapshot BEFORE reset so
      // the loop can read entry.dashboardId + entry.viewName. Fire-and-forget DROP (V13-P-12 carry-forward).
      const combinationRegistry = useFilterCombinationStore.getState().registry;
      for (const entry of Object.values(combinationRegistry)) {
        if (entry.viewName) {
          dropCombinationView({ dashboardId: entry.dashboardId, viewName: entry.viewName }).catch(() => {});
        }
      }
      useFilterCombinationStore.getState().reset();
      // Phase 104 (MAPSYNC-V119-05): 11th store — transient viewport sync, session-only, no server DROP.
      useMapViewportSyncStore.getState().reset();
      // Phase 108 (FSCOPE-V120-02/03): 12th store — transient highlight/flash, session-only, no server DROP.
      useFilterHighlightStore.getState().reset();
      // Phase 111 (MAPVIEW-V121-01): 13th store — transient per-widget live map view,
      // session-only, no server DROP. Prevents one user's map views leaking into the next
      // session's config-panel readouts.
      useMapCurrentViewStore.getState().reset();
    }
  }, [status]);

  // 401-REAUTH chain handler. Phase 7: ALSO captures pre-redirect page state
  // for OIDC mode so the user returns to the same page after IdP round-trip (UX-06).
  // Write happens BEFORE markUnauthenticated to ensure the in-memory page/viewMode
  // values are captured before any state transition unmounts the consuming components.
  useEffect(() => {
    const handler = () => {
      // OIDC-only: in password mode the user re-auths in the same tab — in-memory
      // useState<Page> survives, so no sessionStorage write is needed (CONTEXT.md).
      const authMode = useAuthStore.getState().authMode;
      if (authMode === "oidc") {
        try {
          const payload: ReturnTo = { page, dashboardViewMode };
          sessionStorage.setItem(RETURN_TO_KEY, JSON.stringify(payload));
          expiredHereRef.current = true;   // Phase 115: this document wrote that ReturnTo.
        } catch {
          // Best-effort: sessionStorage may be disabled (private mode in some browsers).
          // Falling through to the default landing page is acceptable.
        }
      }
      markUnauthenticated("session-expired");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
    // Effect deps include page + dashboardViewMode so the handler closure always
    // captures fresh values (otherwise the closure would freeze at mount).
  }, [markUnauthenticated, page, dashboardViewMode]);

  // Phase 115 (DLINK-V121-03): the COMMIT-moment write — fired by LoginPage when the user
  // actually commits to signing in, NOT when the deep link first reaches the login page.
  // Why commit and not arrival: browsing away from login never commits, so nothing is stored;
  // without this, a link you walked away from could hijack a later sign-in in the same tab.
  //
  // ⚠️ DELIBERATELY NOT UNIFIED with the UNAUTHORIZED_EVENT write above. It is tempting to see
  // an inconsistency and collapse them — you cannot. At UNAUTHORIZED_EVENT time the app is still
  // mounted and in-memory `page`/`dashboardViewMode` are the ONLY source of where the user was;
  // by the time this runs those components have unmounted and window.location.search (captured
  // at boot by useDeepLinkDashboard) is the only source of the dashboard id. Two journeys, two
  // sources, two write moments, ONE key. This is a decision, not a defect.
  // Phase 116 (TLINK-V121-03): the table journey uses the same two moments for the same reasons —
  // extended into this SAME function, not a second one, per 116-RESEARCH §Q4.
  const handleSignInCommit = () => {
    // Password mode never leaves the page, so the URL itself is the carrier (proved for dashboards
    // by App.passwordDeepLink.spec.tsx and for tables by App.tablePasswordDeepLink.spec.tsx). A
    // write here would create a SECOND source to reconcile against the same URL-sourced id.
    if (useAuthStore.getState().authMode !== "oidc") return;

    // DASHBOARD WINS — the same explicit precedence the table-open effect uses. Both params present
    // is only reachable by hand-crafting a URL; writing both would stash a tableId that the read
    // side would reject anyway (readPendingTable requires page "datasets"), so simply not writing it
    // is equivalent and clearer.
    const dashboardPending = deepLink.status === "pending";
    const tablePending = !dashboardPending && deepLinkTable.status === "pending";
    if (!dashboardPending && !tablePending) return;   // no link waiting

    try {
      const expectedPage: Page = dashboardPending ? "dashboards" : "datasets";
      if (expiredHereRef.current) {
        const raw = sessionStorage.getItem(RETURN_TO_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as ReturnTo;
          // Conflict rule (115-CONTEXT.md): for an EXPIRY, where you actually were wins. A 401 can
          // outrun the deferred address-bar clear, so a STALE ?dashboard=/?table= can still sit in
          // the bar while the user was elsewhere. The expiry capture is the newer intent.
          if (parsed.page !== undefined && parsed.page !== expectedPage) return;
        }
      }
      // Built conditionally, NOT as a spread with undefined-valued keys: App.signincommit.spec.tsx
      // asserts toEqual({dashboardId, page}) on the PARSED object, and relying on JSON.stringify
      // silently dropping undefined keys would be invisible and fragile.
      // `page` is written EXPLICITLY in both branches so a fresh paste always overwrites any leftover
      // ReturnTo page from an earlier, never-resolved expiry.
      let payload: ReturnTo | null = null;
      const d = deepLink;
      const t = deepLinkTable;
      if (d.status === "pending") {
        payload = { dashboardId: d.id, page: "dashboards" };
      } else if (t.status === "pending") {
        payload = { tableId: t.id, tableMode: t.mode, page: "datasets" };
      }
      if (!payload) return;
      sessionStorage.setItem(RETURN_TO_KEY, JSON.stringify(payload));
    } catch {
      // Best-effort: sessionStorage may be disabled (private mode). The user still signs in;
      // they just land on the list instead of the linked screen.
    }
  };

  // Phase 48 (GATE-V18-01): PERMISSION_DENIED_EVENT listener — re-syncs /me so gated
  // surfaces re-render immediately after a mid-session role change.
  // Uses raw-fetch fetchMe (not apiFetch) to avoid re-triggering the 403 handler (Pitfall 7).
  // Handler reads getState() imperatively — empty dep array is safe (no stale closure).
  useEffect(() => {
    const handler = () => {
      fetchMe().then((me) => {
        if (me) useAuthStore.getState().setPermissions(me.user.roles, me.user.permissions);
      }).catch(() => {});
    };
    window.addEventListener(PERMISSION_DENIED_EVENT, handler);
    return () => window.removeEventListener(PERMISSION_DENIED_EVENT, handler);
  }, []);

  // Phase 7 (UX-06): when bootstrap finishes and the user is authenticated, restore
  // the page state from sessionStorage if it's set. Single-use: clear after restore.
  useEffect(() => {
    if (status !== "authenticated") return;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(RETURN_TO_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ReturnTo;
      if (
        parsed.page === "dashboards" ||
        parsed.page === "datasets" ||
        parsed.page === "settings" ||
        parsed.page === "users" ||
        parsed.page === "roles" ||
        parsed.page === "profile" ||
        // Branding is permission-gated: never restore it for a user who lacks
        // branding:manage (server enforces too, but don't strand them on the page).
        (parsed.page === "branding" && hasPermission(PERMISSIONS.BRANDING_MANAGE))
      ) {
        setPage(parsed.page);
        if (parsed.page !== "dashboards") {
          // Conflict rule (115-CONTEXT.md): for an EXPIRY, where you actually WERE wins. The
          // ?dashboard= still in the bar is stale — a 401 outran DashboardsPage's deferred clear
          // (DashboardsPage.tsx:646-651). Mirror-image of Phase 114's rule, under one principle:
          // whichever signal is the more recent expression of intent wins. On a paste the URL is
          // newer; on an expiry the ReturnTo capture is newer.
          returnToWonElsewhereRef.current = true;
          // SUPPRESS NOW, do not merely delay. deepLinkConsumedRef's existing gate
          // (`page === "dashboards"`) would only DEFER the flip — and `page` may become
          // "dashboards" later this session via a sidebar click, at which point the stale link
          // would silently reopen. That is the Phase 114 Wave-2 defect class, delayed instead of
          // immediate (115-RESEARCH.md §Q4/§Q5 Pitfall 3). Burning the one-shot here kills it.
          deepLinkConsumedRef.current = true;
          // DLINK-V121-07: the bar must not describe a dashboard while the user is on Roles.
          if (hasDashboardParam(window.location.search)) clearDashboardUrl();
        }
        if (parsed.page !== "datasets") {
          // Phase 116 mirror-image of the block above: an expiry captured the user somewhere other
          // than Datasets, so that capture is the newer intent and any ?table= still in the bar is
          // stale (a 401 outran DatasetsPage's deferred clear). Suppress NOW rather than merely
          // delaying — burning the one-shot here stops the stale link silently reopening later in
          // the session if the user navigates to Datasets by hand.
          tableReturnToWonElsewhereRef.current = true;
          tableDeepLinkConsumedRef.current = true;
          // TLINK-V121-06: the bar must not describe a table while the user is on Roles.
          if (hasTableParam(window.location.search)) clearTableUrl();
        }
      }
      if (typeof parsed.dashboardViewMode === "string") {
        setDashboardViewMode(parsed.dashboardViewMode);
      }
    } catch {
      // Corrupt JSON or unknown shape — silently fall through to the default page.
    } finally {
      // Single-use: clear regardless of success/failure (only if we actually read a value).
      if (raw !== null) {
        try {
          sessionStorage.removeItem(RETURN_TO_KEY);
        } catch {
          // sessionStorage disabled — nothing to clean up.
        }
      }
    }
    // Run once per status transition into "authenticated".
  }, [status]);

  // Phase 114 (DLINK-V121-02): a pasted dashboard link is a fresh, explicit intent, so it wins
  // over Phase 7's sessionStorage ReturnTo page restore — including on the failure paths, whose
  // banner belongs on the dashboard list. Ordering is deterministic, not luck: the ReturnTo
  // effect above runs synchronously on the transition into "authenticated", while this one can
  // only fire after an awaited listDashboards() round-trip, and it is declared after it.
  // The ReturnTo block itself is untouched — Phase 115 has to extend it.
  useEffect(() => {
    // Phase 115 (DLINK-V121-03): an expiry captured the user somewhere other than the dashboard
    // list — that is the newer intent. Do not navigate them, and do not show the deep link's
    // failure banner either; the link is dead for this session (see the restore effect above).
    if (returnToWonElsewhereRef.current) return;
    if (deepLink.status === "opened") {
      setPage("dashboards");
      setDashboardViewMode("open");
      // Phase 115: after an OIDC round trip the server returned the browser to a bare `/`
      // (packages/server/src/index.ts:637), so the id came from kbi_returnTo, not the URL —
      // put it back or the bar would describe the LIST while a dashboard is open, breaking
      // Back, copy-link and refresh for OIDC users ONLY (DLINK-V121-07). Idempotent, so this
      // is a no-op on every other arrival path.
      restoreDashboardUrl(deepLink.dashboard.id);
    } else if (deepLink.status === "unavailable" || deepLink.status === "error") {
      setPage("dashboards");
    }
  }, [deepLink]);

  // Phase 116 (TLINK-V121-02/04): the table sibling of the dashboard deep-link effect above. The
  // existing effect is UNTOUCHED — this one carries the whole precedence rule.
  //
  // PRECEDENCE, stated explicitly rather than left to effect-declaration order (116-RESEARCH §Q4):
  // DASHBOARD WINS. If any dashboard link is in play at all — pending, opened, unavailable or error —
  // this effect does nothing except strip the stale ?table= so the address bar does not describe two
  // screens at once. Arbitrary between the two entities, but explicit and testable, and it leaves
  // the dashboard path needing zero changes. `?dashboard=&?table=` together is only reachable by
  // hand-crafting a URL; it has no UI path.
  useEffect(() => {
    if (tableReturnToWonElsewhereRef.current) return;
    if (deepLink.status !== "none") {
      if (hasTableParam(window.location.search)) clearTableUrl();
      tableDeepLinkConsumedRef.current = true;
      return;
    }
    if (deepLinkTable.status === "opened") {
      setPage("datasets");
      // After an OIDC round trip the server returns the browser to a bare `/`, so the id came from
      // kbi_returnTo rather than the URL — put it back, or the bar would describe the tables LIST
      // while a table is open (TLINK-V121-06). Idempotent, so a no-op on every other arrival path.
      restoreTableUrl(deepLinkTable.table.id, deepLinkTable.mode);
    } else if (deepLinkTable.status === "unavailable" || deepLinkTable.status === "error") {
      setPage("datasets");
    }
  }, [deepLink, deepLinkTable]);

  // Client-side access gate for the branding page: if the active page is
  // "branding" but the user lacks branding:manage (e.g. their role changed
  // mid-session, or a stale restored page), fall back to dashboards. The nav
  // link is already hidden and the server returns 403 on PUT — this closes the
  // gap where the page itself was still reachable/rendered.
  useEffect(() => {
    if (status !== "authenticated") return;
    if (page === "branding" && !hasPermission(PERMISSIONS.BRANDING_MANAGE)) {
      setPage("dashboards");
    }
  }, [status, page, hasPermission]);

  // Phase 11 MAP-01/MAP-02: probe WMS capabilities once per authenticated session.
  // Fires AFTER auth-status gating so it only runs when the user is authenticated
  // (the server's requireConfig middleware guards /api/wms/capabilities).
  // initWmsCapabilities() is idempotent — safe to call in a re-rendering effect.
  useEffect(() => {
    if (status === "authenticated") {
      initWmsCapabilities();
    }
  }, [status]);

  // USERS-V18-04: lazy banner fetch — SEPARATE from the auth bootstrap chain (Pitfall 6).
  // Only users with users:assign_roles see the banner; everyone else skips the fetch entirely.
  // Counts non-bootstrap users with no explicit role assignments (roles.length === 0 && !is_bootstrap).
  useEffect(() => {
    if (status !== "authenticated" || !hasPermission(PERMISSIONS.USERS_ASSIGN_ROLES)) return;
    const controller = new AbortController();
    (async () => {
      try {
        const users = await listUsers(controller.signal);
        const count = users.filter((u) => !u.is_bootstrap && u.roles.length === 0).length;
        setUnassignedCount(count);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        // Swallow other errors — banner is non-critical; a failed fetch just hides it.
      }
    })();
    return () => controller.abort();
  }, [status, hasPermission]);

  // One shell, defined once, so the deep-link hold and the auth-bootstrap hold are LITERALLY the
  // same markup — there is no second loading state for the user to notice changing.
  const loadingShell = (
    <div className="login-shell"><div className="muted">Loading…</div><BrandStyleInjector /><Toast /></div>
  );

  if (status === "unknown") {
    return loadingShell;
  }

  // Phase 115 boundary: an unauthenticated deep-link arrival goes to LOGIN, not to the hold
  // below — this branch must stay ABOVE it or such a visit would wait on Loading… forever.
  // The ?dashboard param is deliberately left in the address bar for Phase 115 to consume.
  if (status !== "authenticated") {
    return <><LoginPage deepLinkPending={deepLink.status === "pending"} deepLinkTablePending={deepLinkTable.status === "pending"} onSignInCommit={handleSignInCommit} /><BrandStyleInjector /><Toast /></>;
  }

  // Phase 114 (DLINK-V121-02): hold the app-level Loading… while a deep link resolves. We must
  // NOT hand off to DashboardsPage here: its own "Loading dashboards…" (DashboardsPage.tsx:202)
  // renders INSIDE the list chrome, so doing so would put the dashboard-list page on screen —
  // exactly what ROADMAP criterion 1 forbids. The same reasoning applies to DatasetsPage: its own
  // "Loading tables…" (DatasetsPage.tsx:170) renders INSIDE the list chrome, so handing off here
  // would put the tables-list page on screen — exactly what TLINK-V121-02 forbids.
  if (deepLink.status === "pending" || deepLinkTable.status === "pending") {
    return loadingShell;
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeKey={page}
        onSelect={(key) => {
          // Leave-guard for the branding page: if the user has unsaved changes,
          // prompt to confirm; on confirm, revert live :root to the saved brand.
          // Intercepts here (before setPage) to avoid the leave-revert race (Pitfall 2).
          if (page === "branding" && brandPageGuard.isDirty) {
            if (!window.confirm("Discard unsaved branding changes?")) return;
            brandPageGuard.revert?.();
          }
          setPage(key as Page);
          setDashboardViewMode("list");
        }}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
      />
      <div className="main">
        <Topbar onNavigateProfile={() => setPage("profile")} />
        {unassignedCount !== null && unassignedCount > 0 && !bannerDismissed && (
          <div className="onboarding-banner" role="status">
            {unassignedCount} user{unassignedCount !== 1 ? "s are" : " is"} on the default analyst role —{" "}
            <button className="banner-link" onClick={() => setPage("users")}>
              Review in User Management
            </button>
            <button className="banner-dismiss" aria-label="Dismiss" onClick={() => setBannerDismissed(true)}>×</button>
          </div>
        )}
        {deepLink.status === "unavailable" && !deepLinkBannerDismissed && !returnToWonElsewhereRef.current && (
          <div className="onboarding-banner" role="status" data-testid="deep-link-banner">
            {DEEP_LINK_UNAVAILABLE_MESSAGE}
            <button className="banner-dismiss" aria-label="Dismiss" onClick={() => setDeepLinkBannerDismissed(true)}>×</button>
          </div>
        )}
        {deepLinkTable.status === "unavailable" && !deepLinkTableBannerDismissed && !tableReturnToWonElsewhereRef.current && (
          <div className="onboarding-banner" role="status" data-testid="deep-link-table-banner">
            {DEEP_LINK_TABLE_UNAVAILABLE_MESSAGE}
            <button className="banner-dismiss" aria-label="Dismiss" onClick={() => setDeepLinkTableBannerDismissed(true)}>×</button>
          </div>
        )}
        {page === "dashboards" && <DashboardsPage onViewChange={setDashboardViewMode} initialOpenDashboard={initialOpenDashboard} />}
        {page === "datasets" && <DatasetsPage initialOpenTable={initialOpenTable} />}
        {page === "settings" && (
          <div className="muted">Section coming soon.</div>
        )}
        {page === "branding" && hasPermission(PERMISSIONS.BRANDING_MANAGE) && <BrandingSettingsPage />}
        {page === "users" && <UsersPage />}
        {page === "roles" && <RolesPage />}
        {page === "profile" && <ProfilePage />}
      </div>
      <BrandStyleInjector />
      <Toast />
    </div>
  );
};

export default App;
