import { useEffect, useState } from "react";
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
import { UNAUTHORIZED_EVENT, PERMISSION_DENIED_EVENT, fetchMe, dropFilterView, dropDynamicView, listUsers } from "./api/client";
import { PERMISSIONS } from "./lib/permissions";

type Page = "dashboards" | "datasets" | "settings" | "users" | "roles" | "profile";

// Phase 7 (UX-06 / TS-14): return-to-page after OIDC re-auth.
// Storage shape — top-level page + dashboard view mode are sufficient (per CONTEXT.md;
// deep-link state inside dashboards is OUT OF SCOPE for v1.1).
type ReturnTo = {
  page?: Page;
  dashboardViewMode?: string;
};

const RETURN_TO_KEY = "kbi_returnTo";
const SIDEBAR_COLLAPSED_KEY = "kbi_sidebarCollapsed";

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

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

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
        parsed.page === "profile"
      ) {
        setPage(parsed.page);
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

  if (status === "unknown") {
    return <div className="login-shell"><div className="muted">Loading…</div><Toast /></div>;
  }

  if (status !== "authenticated") {
    return <><LoginPage /><Toast /></>;
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeKey={page}
        onSelect={(key) => { setPage(key as Page); setDashboardViewMode("list"); }}
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
        {page === "dashboards" && <DashboardsPage onViewChange={setDashboardViewMode} />}
        {page === "datasets" && <DatasetsPage />}
        {page === "settings" && (
          <div className="muted">Section coming soon.</div>
        )}
        {page === "users" && <UsersPage />}
        {page === "roles" && <RolesPage />}
        {page === "profile" && <ProfilePage />}
      </div>
      <Toast />
    </div>
  );
};

export default App;
