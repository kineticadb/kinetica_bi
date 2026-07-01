import { create } from "zustand";
import { AuthUser, AuthMode, fetchAuthConfig, fetchMe, login as apiLogin, logout as apiLogout } from "../api/client";

type AuthStatus = "unknown" | "authenticated" | "unauthenticated";
type AuthReason = "session-expired" | null;
type AuthModeOrNull = AuthMode | null;

type AuthState = {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
  reason: AuthReason;
  authMode: AuthModeOrNull;
  // Phase 74 (SETTINGS-V115-03): lead-time (minutes) before view expiry when Phase 78 should
  // send a keep-alive touch. Defaults to 1; set from /api/me on bootstrap.
  ttlKeepaliveLeadMinutes: number;
  // Phase 90 (COMBO-V118-03): per-table combination ceiling; set from /api/me on bootstrap. Default 10.
  maxCombinationViewsPerTable: number;
  // Phase 94 (FSCOPE-V118-03): deploy-time dv filter-scope disable; from /api/me. Default false (enabled).
  dvFilterScopeDisabled: boolean;
  // Phase 102 (BARGRP-V119-03): deploy-time bar group-by series cap; set from /api/me on bootstrap. Default 12.
  maxBarGroupBySeriesCap: number;
  bootstrap: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  markUnauthenticated: (reason?: AuthReason) => void;
  hasPermission: (perm: string) => boolean;
  setPermissions: (roles: string[], permissions: string[]) => void;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "unknown",
  user: null,
  error: null,
  reason: null,
  authMode: null,
  ttlKeepaliveLeadMinutes: 1,
  maxCombinationViewsPerTable: 10,
  dvFilterScopeDisabled: false,
  maxBarGroupBySeriesCap: 12,
  bootstrap: async () => {
    // Step 1: pre-auth config read. Failure → silent fallback (LoginPage falls back to password form).
    // CONTEXT.md / PITFALL I-03/I-04: must NOT throw out of bootstrap.
    try {
      const config = await fetchAuthConfig();
      set({ authMode: config.authMode });
    } catch {
      // authMode stays null — LoginPage renders password form. Self-correcting on next load.
    }
    // Step 2: post-auth /me. Existing 401-as-null contract preserved.
    try {
      const me = await fetchMe();
      if (me) {
        // /me carries authMode now; latest-write-wins (more authoritative than /config's pre-auth read).
        set({ status: "authenticated", user: me.user, authMode: me.authMode, ttlKeepaliveLeadMinutes: me.ttlKeepaliveLeadMinutes, maxCombinationViewsPerTable: me.maxCombinationViewsPerTable, dvFilterScopeDisabled: me.dvFilterScopeDisabled, maxBarGroupBySeriesCap: me.maxBarGroupBySeriesCap, error: null, reason: null });
      } else {
        // bootstrap-driven 401: honest "not logged in", NOT mid-session expiry — reason stays null
        set({ status: "unauthenticated", user: null, reason: null });
      }
    } catch {
      set({ status: "unauthenticated", user: null, reason: null });
    }
  },
  login: async (username, password) => {
    set({ error: null });
    try {
      const user = await apiLogin(username, password);
      set({ status: "authenticated", user, error: null, reason: null });
    } catch (err) {
      set({ status: "unauthenticated", user: null, error: (err as Error).message, reason: null });
      throw err;
    }
  },
  logout: async () => {
    try {
      await apiLogout();
    } finally {
      // Explicit logout: user clicked the button, they know what happened — reason stays null
      set({ status: "unauthenticated", user: null, reason: null });
    }
  },
  // reason defaults to null; UNAUTHORIZED_EVENT path passes "session-expired"
  markUnauthenticated: (reason: AuthReason = null) =>
    set({ status: "unauthenticated", user: null, reason }),
  // Phase 48 (GATE-V18-01): reads get().user to avoid stale closure (Pitfall 3).
  // Returns false when user is null (unauthenticated) — always safe to call.
  hasPermission: (perm: string) => new Set(get().user?.permissions ?? []).has(perm),
  // setPermissions: in-place update of user.roles + user.permissions; no-op when user is null.
  // Permissions vanish naturally when markUnauthenticated sets user=null (no reset chain entry needed).
  setPermissions: (roles: string[], permissions: string[]) =>
    set((s) => (s.user ? { user: { ...s.user, roles, permissions } } : s)),
}));
