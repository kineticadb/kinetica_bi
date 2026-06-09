// env first — see env.ts: must evaluate before modules that fail-fast on env
// at import time (sessionStore.ts SESSION_ENCRYPTION_KEY boot validation).
import "./env";
import { randomBytes, timingSafeEqual } from "node:crypto";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import {
  clearSessionCookie,
  decodeAndVerifyJwt,
  issueSessionCookie,
  loadSessionForRequest,
  requireAuth,
  verifyKineticaCredentials,
  type AuthedRequest,
} from "./auth";
import { kineticaSql as kineticaSqlHelper, kineticaWms, kineticaShowTable } from "./kinetica";
import { parseTemporalColumns } from "./lib/showTableTypes";
import { buildFilterViewName } from "./lib/viewNaming";
import { createOrReplaceMaterialized } from "./lib/materializedView";
// v1.6 Phase 32 Plan 03: dynamic-view materialize + delete need the Kinetica view-name
// composer (CONTEXT.md § D7 — _kbi_dv_u<userId>_d<dashboardId>_<dynamicViewId>).
import { buildDynamicViewName } from "./lib/dynamicViewName";
// v1.7 Phase 38 (SCHEMA-V17-06): /api/quantile NTILE bucket-MIN query backing Phase 39 Auto-suggest.
import { buildQuantileSql, parseQuantileResponse } from "./lib/quantileSql";
import { buildTopValuesSql, parseTopValuesResponse } from "./lib/topValuesSql";
import { buildColumnStatsSql, parseColumnStatsResponse } from "./lib/columnStatsSql";
import type { ActiveFilter } from "./lib/whereClause";
import { composeWhereClause, type SpatialFilter, type SpatialTarget } from "./lib/spatialWhereClause";
// v1.4 Phase 18 — Map info popup spatial-proximity SQL builders + radius conversion.
// All three modes (latlon, wkt, wkb=Kinetica geometry column) are live. The
// wkb mode shares STXY_DISTANCE with wkt — they differ only in column name.
import {
  buildLatLonQuery,
  buildWktQuery,
  buildWkbQuery,
  type SpatialMode,
  type SpatialColumns,
} from "./lib/spatialQuery";
import { pxToGroundDistance, pxToGroundDegrees } from "./lib/radiusConversion";
import { getCachedCapabilities } from "./wmsCapabilities";
import {
  KineticaAuthError,
  KineticaPermissionError,
  KineticaUpstreamError,
} from "./kineticaErrors";
import { createSession, deleteSession, startSessionSweep, tryDecodeAccessTokenExp } from "./sessionStore";
import {
  createDashboard,
  createWidget,
  createTable,
  createView,
  db,
  deleteDashboard,
  deleteWidget,
  deleteTable,
  deleteView,
  getDashboard,
  getWidget,
  getTable,
  getView,
  listDashboards,
  listWidgets,
  listTables,
  listViews,
  updateDashboard,
  updateWidget,
  updateTable,
  updateViewFilter,
  updateViewStatus,
  listDashboardTables,
  addDashboardTable,
  removeDashboardTable,
  listDashboardLayers,
  createDashboardLayer,
  updateDashboardLayer,
  deleteDashboardLayer,
  reorderDashboardLayers,
  getDashboardLayer,
  // v1.6 Phase 32 Plan 02: Dynamic-view CRUD helpers (DV-V16-01).
  listDashboardDynamicViews,
  createDashboardDynamicView,
  getDashboardDynamicView,
  updateDashboardDynamicView,
  // v1.6 Phase 32 Plan 03: DELETE /api/dynamic-view/:id needs the row-removal helper.
  deleteDashboardDynamicView,
} from "./db";
import { DashboardLayer, Table, Widget } from "./types";
// v1.6 Phase 32 Plan 02: substituteViewToken validates that operator-supplied
// template_sql contains `{view}` at create + update time (CONTEXT.md D1).
// Throwing MissingViewTokenError → route returns 400 BEFORE persistence.
import { substituteViewToken, MissingViewTokenError } from "./lib/dynamicViewSql";
import {
  validateOidcEnv,
  initOidcClient,
  buildAuthorizationUrl,
  exchangeCode,
  extractUsername,
  mapOidcError,
  type OidcConfig,
} from "./oidc";
// v1.8 RBAC (SCHEMA-V18-03): bootstrap admin username resolution — used for the OIDC
// default-admin boot warning. Import AFTER "./env" (env must stay the first import).
// v1.8 Phase 48 Plan 01 (GATE-V18-01): getEffectiveRolesAndPermissions wired to /me handler.
import { getAppAdminUsername, getEffectiveRolesAndPermissions, getEffectiveRoles, getEffectivePermissions } from "./lib/rbacDb";
import { emitRbacAudit } from "./lib/rbacAudit";
// v1.8 Phase 47 Plan 03 (GUARD-V18-02/03/04): requirePermission factory for mutation route gating.
import { requirePermission } from "./rbac";
// v1.8 Phase 47: PERMISSIONS catalog — canonical permission constants for server enforcement.
import { PERMISSIONS, BUILTIN_ROLES } from "./lib/permissions";
import type { Permission } from "./lib/permissions";
// v1.10 Phase 55-02 (ENFORCE-V110-01..04): per-dashboard view access enforcement + grant CRUD.
import { canViewDashboard, listDashboardGrants, addDashboardGrant, removeDashboardGrant } from "./lib/dashboardAccessDb";

export const createApp = async (): Promise<express.Express> => {
  const app = express();

  const corsOrigins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  app.use(
    cors({
      origin: corsOrigins.length ? corsOrigins : true,
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // ---- Plan 05-03: AUTH_MODE + OIDC boot ----
  // Read ONCE at createApp() top — NEVER per-route (ARCHITECTURE AP-5).
  // Note: process.env.AUTH_MODE legitimately appears TWICE in this file:
  //   1. The canonical read on the next line (the only "logical" read).
  //   2. The error-message interpolation in the throw below (renders the offending value
  //      so the operator sees what they actually set in the environment).
  // AP-5 forbids per-route reads — both occurrences are at boot, inside createApp(),
  // before any route handler is mounted.
  const authMode = (process.env.AUTH_MODE || "password") as "password" | "oidc";
  if (authMode !== "password" && authMode !== "oidc") {
    throw new Error(`[boot] AUTH_MODE must be 'password' or 'oidc' (got: ${process.env.AUTH_MODE})`);
  }

  // Dev-mode split-port workaround (TD-V11-01): when set, prefixes post-OIDC-callback
  // redirects with an absolute origin so the SPA on Vite loads after login. Empty in
  // production (Express serves the built SPA same-origin, so relative paths just work).
  const webRedirectBase = process.env.WEB_REDIRECT_BASE ?? "";

  // ---- Plan 08-01: AUTH_MODE-change session wipe (MODE-05) ----
  // Data-derived contradiction check: if any sessions row has credential_type that
  // contradicts the current authMode, delete those rows before app.listen() so the
  // server never serves a request that could resurrect a wrong-mode session via cookie
  // cache (PITFALLS M-01, M-04). Self-healing: after one successful wipe the
  // contradicting count is 0 and subsequent boots are no-ops.
  // Anti-patterns avoided: AP-1 (this is NOT in db.ts), AP-2 (NOT in sessionStore.ts).
  // Runs unconditionally in BOTH modes — symmetric for password→oidc upgrade AND
  // oidc→password rollback. The COUNT is essentially free.
  const wipeSessionsOnModeChange = (): void => {
    const contradictingType: "password" | "oidc" = authMode === "oidc" ? "password" : "oidc";
    db.transaction(() => {
      const countRow = db
        .prepare("SELECT COUNT(*) AS n FROM sessions WHERE credential_type = ?")
        .get(contradictingType) as { n: number } | undefined;
      const contradictingCount = countRow?.n ?? 0;
      if (contradictingCount === 0) return; // silent no-op
      const result = db
        .prepare("DELETE FROM sessions WHERE credential_type = ?")
        .run(contradictingType);
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "info",
          event: "auth_mode_change_wipe",
          from: contradictingType,
          to: authMode,
          deleted: result.changes,
        })
      );
    })();
  };
  wipeSessionsOnModeChange();

  let oidcConfig: OidcConfig | null = null;
  if (authMode === "oidc") {
    // SC6 fail-fast: validateOidcEnv throws on missing var; initOidcClient throws on
    // Issuer.discover network/parse failure. createApp() rejects; bootstrap IIFE crashes
    // the process before app.listen.
    oidcConfig = validateOidcEnv();
    await initOidcClient(oidcConfig);

    // Structured boot log (pre-empts Phase 8 SC5 wording for I-06 diagnosability).
    // Operators searchable via: jq 'select(.event == "oidc_boot")'
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        event: "oidc_boot",
        message: `Kinetica must be configured to trust tokens from ${oidcConfig.issuer} with audience ${oidcConfig.clientId}`,
        issuer: oidcConfig.issuer,
        audience: oidcConfig.clientId,
        redirect_uri: oidcConfig.redirectUri,
      })
    );

    // v1.8 RBAC (SCHEMA-V18-03): warn-and-boot when the bootstrap admin is still the
    // default "admin" in OIDC mode. OIDC usernames come from the IdP claim (post-regex),
    // which is rarely literally "admin" — so no OIDC user would short-circuit to admin and
    // roles could only be assigned by users already granted admin. NON-FATAL (analyst default
    // means nobody is locked out). Operators search: jq 'select(.event=="rbac_bootstrap_admin_warning")'.
    const appAdminUsername = getAppAdminUsername();
    if (appAdminUsername.toLowerCase() === "admin") {
      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          event: "rbac_bootstrap_admin_warning",
          message:
            "AUTH_MODE=oidc but APP_ADMIN_USERNAME is the default 'admin'. OIDC usernames come from the IdP claim and are rarely literally 'admin'. Set APP_ADMIN_USERNAME to the intended admin's OIDC username (post-regex claim value), or roles can only be assigned by a user already granted the admin role.",
          app_admin_username: appAdminUsername,
          auth_mode: authMode,
        })
      );
    }

    // Unauthenticated reachability probe — fire-and-forget.
    // NOT an OIDC-trust test (no token to send); catches DNS/TLS/connectivity at boot.
    // Failure → structured warn + continue (CONTEXT.md: "Don't fail-fast on Kinetica unreachability").
    // Wrapped in async IIFE so any sync throw, async rejection, or non-thenable return
    // from fetch() is fully contained and never propagates to createApp's caller.
    const kineticaUrl = process.env.KINETICA_URL;
    if (kineticaUrl) {
      const probeUrl = `${kineticaUrl.replace(/\/$/, "")}/version`;
      // TODO: Could be made env-configurable via KINETICA_HEALTHCHECK_PATH if any
      // deployment lacks /version. Default hardcoded per CONTEXT.md design discretion.
      void (async () => {
        try {
          const response = await fetch(probeUrl);
          if (!response.ok) {
            console.warn(
              JSON.stringify({
                ts: new Date().toISOString(),
                level: "warn",
                event: "kinetica_unreachable",
                url: probeUrl,
                status: response.status,
                message: "Kinetica /version probe returned non-2xx; check KINETICA_URL and trust config",
              })
            );
          }
        } catch (err) {
          console.warn(
            JSON.stringify({
              ts: new Date().toISOString(),
              level: "warn",
              event: "kinetica_unreachable",
              url: probeUrl,
              status: 0,
              message: `Kinetica /version probe failed: ${err instanceof Error ? err.message : String(err)}`,
            })
          );
        }
      })();
    }
  }

  const requireConfig = (req: Request, res: Response, next: NextFunction) => {
    if (!process.env.KINETICA_URL) {
      return res.status(500).json({ error: "Missing KINETICA_URL environment variable." });
    }
    return next();
  };

  // asyncHandler: wraps async route handlers so that thrown errors (including typed Kinetica errors)
  // are forwarded to Express's error middleware via next(err). Without this, Express 4 silently
  // swallows promise rejections from async handlers. Plan 03-02 uses Option A (file-local helper,
  // zero new deps) per the CONTEXT.md interface note.
  const asyncHandler =
    <T extends Request = Request>(
      fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
    ) =>
    (req: T, res: Response, next: NextFunction): void => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "kinetica-bi-backend", version: "0.1.0" });
  });

  // Auth
  app.post("/api/auth/login", async (req, res) => {
    // Plan 05-03: OIDC mode disables password login (MODE-01)
    if (authMode !== "password") {
      return res.status(400).json({ error: "Password login is disabled. Use OIDC." });
    }

    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (!username || !password) {
      return res.status(400).json({ error: "username and password are required." });
    }
    const result = await verifyKineticaCredentials(username, password);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.message });
    }
    const kineticaUrl = process.env.KINETICA_URL;
    if (!kineticaUrl) {
      return res.status(500).json({ error: "KINETICA_URL is not configured." });
    }
    try {
      const sid = createSession({ username, secret: password, kineticaUrl });
      // Phase 47 (v1.8): upsert into known_users on successful login so GET /api/users
      // can list every user who has ever logged in (union with user_roles).
      // Username lowercased per Phase 46 convention. Placed on success path only (Pitfall 4).
      db.prepare(
        `INSERT INTO known_users (username, first_seen, last_seen)
         VALUES (lower(?), datetime('now'), datetime('now'))
         ON CONFLICT(username) DO UPDATE SET last_seen = datetime('now')`
      ).run(username);
      issueSessionCookie(res, username, sid);
    } catch (error) {
      return res.status(500).json({ error: String(error) });
    }
    // v1.8 (post-48 gap fix): login response mirrors /me — without roles/permissions here,
    // hasPermission() is false for everything until a refresh re-runs bootstrap (/me).
    const rp = getEffectiveRolesAndPermissions(username);
    return res.json({ user: { username, roles: rp.roles, permissions: rp.permissions } });
  });

  app.post("/api/auth/logout", (req, res) => {
    // Best-effort: extract sid even if cookie is malformed; idempotent delete.
    const decoded = decodeAndVerifyJwt(req);
    if (decoded?.sid) {
      try { deleteSession(decoded.sid); } catch { /* swallow — logout never fails */ }
    }
    clearSessionCookie(res);
    return res.status(204).send();
  });

  app.get("/api/auth/me", (req, res) => {
    // MIGRATION (Pitfall P13): /me must require the sessions row to exist.
    // Previously this only did a JWT signature check; now it checks row existence.
    const loaded = loadSessionForRequest(req);
    if (!loaded) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Not authenticated.", code: "REAUTH_REQUIRED" });
    }
    // Phase 7 (UX-08 / D-3): include authMode top-level. Closes over the boot-captured const at
    // line 82 — NEVER re-read process.env here (ARCHITECTURE.md AP-5).
    // Phase 48 (GATE-V18-01): extend with roles + permissions for frontend hasPermission gating.
    // Bootstrap-admin short-circuit and analyst fallback are handled inside getEffectiveRolesAndPermissions.
    const { roles, permissions } = getEffectiveRolesAndPermissions(loaded.session.username);
    return res.json({ user: { username: loaded.session.username, roles, permissions }, authMode });
  });

  // ---- Plan 05-03: AUTH_MODE-aware routes ----

  // GET /api/auth/config — unauthenticated; bare {authMode}; Cache-Control: no-store (PITFALLS I-03).
  // Mounted BEFORE requireAuth so frontend bootstrap can read it without a session cookie.
  app.get("/api/auth/config", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return res.json({ authMode });
  });

  // GET /api/auth/oidc/start — generates state+nonce, sets oidc_state httpOnly cookie, 302→IdP.
  // Returns 400 in password mode (route mounted but inactive, per CONTEXT.md).
  app.get("/api/auth/oidc/start", (req, res) => {
    if (authMode !== "oidc") {
      return res.status(400).json({ error: "OIDC is not enabled." });
    }
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    res.cookie("oidc_state", JSON.stringify({ state, nonce }), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60 * 1000,           // 10-minute window
      secure: process.env.NODE_ENV === "production",
    });
    const url = buildAuthorizationUrl(state, nonce);
    return res.redirect(url);
  });

  // GET /api/auth/oidc/callback — uses asyncHandler so errors forward to errorMiddleware.
  // Every exit path clears the oidc_state cookie (CONTEXT.md locked).
  // All errors redirect to /login?error=<friendlyCode>; never 500/blank (Phase 5 SC2).
  app.get("/api/auth/oidc/callback", asyncHandler(async (req, res) => {
    if (authMode !== "oidc") {
      return res.status(400).json({ error: "OIDC is not enabled." });
    }

    // Parse stored state cookie. Clear it UNCONDITIONALLY before any other logic
    // (CONTEXT.md: cookie cleared on every callback exit — success + all errors).
    const rawCookie = (req.cookies as Record<string, string | undefined> | undefined)?.oidc_state;
    res.clearCookie("oidc_state", { path: "/" });

    let stored: { state: string; nonce: string } | null = null;
    try {
      stored = rawCookie ? (JSON.parse(rawCookie) as { state: string; nonce: string }) : null;
    } catch {
      stored = null;
    }

    const query = req.query as Record<string, string | undefined>;
    const codeParam = query.code;
    const returnedState = query.state;
    const idpError = query.error;

    // IdP returned error before code exchange.
    if (idpError) {
      console.error("[oidc] callback: IdP returned error", {
        idpError,
        desc: query.error_description,
      });
      const friendly = idpError === "access_denied" ? "oidc_denied" : "oidc_invalid";
      return res.redirect(`${webRedirectBase}/login?error=${friendly}`);
    }

    // Missing required params or cookie.
    if (!codeParam || !returnedState || !stored) {
      console.error("[oidc] callback: missing code/state/cookie", {
        hasCode: Boolean(codeParam),
        hasState: Boolean(returnedState),
        hasCookie: Boolean(stored),
      });
      return res.redirect(`${webRedirectBase}/login?error=oidc_invalid`);
    }

    // Timing-safe state comparison (PITFALLS C-02).
    // Length check first — timingSafeEqual throws if buffers differ in length (RESEARCH Pitfall 6).
    const a = Buffer.from(returnedState);
    const b = Buffer.from(stored.state);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      console.error("[oidc] callback: state mismatch");
      return res.redirect(`${webRedirectBase}/login?error=oidc_invalid`);
    }

    // Token exchange + ID token verification.
    // exchangeCode internally checks: signature (JWKS), aud, iss, exp, nonce.
    let exchange: { accessToken: string; idToken: string; claims: Record<string, unknown> };
    try {
      exchange = await exchangeCode(codeParam, stored.state, stored.nonce);
    } catch (err) {
      const friendly = mapOidcError(err);
      console.error("[oidc] callback: token exchange failed", {
        friendlyCode: friendly.code,
        rawError: err instanceof Error ? err.message : String(err),
      });
      return res.redirect(`${webRedirectBase}/login?error=${friendly.code}`);
    }

    const { accessToken, idToken, claims } = exchange;

    // Username extraction (PITFALLS T-02: ONLY id_token claims, NEVER access_token).
    if (!oidcConfig) {
      // Defensive: oidcConfig is set when authMode==='oidc' at boot. Reaching here without
      // it is a logic regression. Treat as oidc_invalid; route guard above is the primary defense.
      console.error("[oidc] callback: oidcConfig missing despite authMode=oidc");
      return res.redirect(`${webRedirectBase}/login?error=oidc_invalid`);
    }
    const username = extractUsername(claims, oidcConfig);
    if (!username) {
      console.error("[oidc] callback: username claim absent or empty", {
        claim: oidcConfig.usernameClaim,
      });
      return res.redirect(`${webRedirectBase}/login?error=oidc_no_username`);
    }

    // Session creation. Phase 4 contract:
    //   createSession({ username, secret, kineticaUrl, credentialType, idToken })
    const kineticaUrl = process.env.KINETICA_URL;
    if (!kineticaUrl) {
      console.error("[oidc] callback: KINETICA_URL not configured");
      return res.redirect(`${webRedirectBase}/login?error=oidc_invalid`);
    }

    // PITFALL T-05: warn (do not abort) if the access_token is opaque or its exp claim is unparseable.
    // This means the proactive expiry check in getSession (Plan 06-02) will be skipped for this session;
    // a Kinetica reactive 401 still fires the existing REAUTH chain.
    // Once-per-login: fires at session creation, NOT per request.
    if (tryDecodeAccessTokenExp(accessToken) === null) {
      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          event: "oidc_opaque_access_token",
          message: "access_token is opaque or has no parseable exp claim — proactive expiry detection disabled for this session; verify Kinetica trust accepts opaque tokens",
          username,
        })
      );
    }

    const sid = createSession({
      username,
      secret: accessToken,
      kineticaUrl,
      credentialType: "oidc",
      idToken,
    });
    // Phase 47 (v1.8): upsert into known_users on successful OIDC login.
    // Username lowercased per Phase 46 convention. Placed on success path only (Pitfall 4).
    db.prepare(
      `INSERT INTO known_users (username, first_seen, last_seen)
       VALUES (lower(?), datetime('now'), datetime('now'))
       ON CONFLICT(username) DO UPDATE SET last_seen = datetime('now')`
    ).run(username);
    issueSessionCookie(res, username, sid);
    return res.redirect(`${webRedirectBase}/`);
  }));

  // All routes below require authentication.
  app.use("/api", requireAuth);

  // Dashboard persistence
  // ENFORCE-V110-01: server-side filter — bypass users (manage_access) get all;
  // everyone else gets only dashboards for which canViewDashboard returns true.
  app.get("/api/dashboards", (req, res) => {
    const username = (req as AuthedRequest).user!.creds.username;
    const all = listDashboards();
    const visible = all.filter((d) => canViewDashboard(username, d.id));
    return res.json({ data: visible });
  });

  app.post("/api/dashboards", ...requirePermission(PERMISSIONS.DASHBOARDS_CREATE), (req, res) => {
    const { name, description } = req.body as { name?: string; description?: string };
    if (!name) return res.status(400).json({ error: "Dashboard name is required." });
    const dashboard = createDashboard(name, description);
    return res.status(201).json(dashboard);
  });

  app.patch("/api/dashboards/:id", ...requirePermission(PERMISSIONS.DASHBOARDS_EDIT), (req, res) => {
    const id = Number(req.params.id);
    const updated = updateDashboard(id, req.body);
    if (!updated) return res.status(404).json({ error: "Dashboard not found." });
    return res.json(updated);
  });

  app.delete("/api/dashboards/:id", ...requirePermission(PERMISSIONS.DASHBOARDS_DELETE), (req, res) => {
    const id = Number(req.params.id);
    const ok = deleteDashboard(id);
    if (!ok) return res.status(404).json({ error: "Dashboard not found." });
    return res.status(204).send();
  });

  // ─── Dashboard Access Grant CRUD (ENFORCE-V110-03/04) ─────────────────────────
  // All three routes are gated by dashboards:manage_access. Admin and designer hold it
  // by default; manage_access holders are also bypass users (see canViewDashboard), so
  // 404 here means truly absent (not a denied visibility case).
  // Audit emitted on-change only (audit-on-change decision) to avoid noise from idempotent re-grants.

  // GET /api/dashboards/:id/access — list grants (manage_access holders only)
  app.get("/api/dashboards/:id/access", ...requirePermission(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS), (req, res) => {
    const id = Number(req.params.id);
    if (!getDashboard(id)) return res.status(404).json({ error: "Dashboard not found." });
    return res.json({ grants: listDashboardGrants(id) });
  });

  // POST /api/dashboards/:id/access — add a user or role grant
  app.post("/api/dashboards/:id/access", ...requirePermission(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS), (req, res) => {
    const id = Number(req.params.id);
    const { grantee_type, grantee } = req.body as { grantee_type?: string; grantee?: string };
    if ((grantee_type !== "user" && grantee_type !== "role") || typeof grantee !== "string" || grantee.trim() === "") {
      return res.status(400).json({ error: "grantee_type ('user'|'role') and grantee are required." });
    }
    if (!getDashboard(id)) return res.status(404).json({ error: "Dashboard not found." });
    const actor = (req as AuthedRequest).user!.creds.username;
    const before = listDashboardGrants(id);
    const inserted = addDashboardGrant(id, grantee_type, grantee);
    const after = listDashboardGrants(id);
    if (inserted) {
      emitRbacAudit(db, {
        actor,
        action: "dashboard_access_granted",
        target: `dashboard:${id}:${grantee_type}:${grantee.trim().toLowerCase()}`,
        before_json: JSON.stringify(before),
        after_json: JSON.stringify(after),
      });
    }
    return res.status(201).json({ grants: after });
  });

  // DELETE /api/dashboards/:id/access — remove a user or role grant (body carries grantee_type + grantee)
  // Idempotent: removing a non-existent grant returns 200 with current grants (not 404).
  app.delete("/api/dashboards/:id/access", ...requirePermission(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS), (req, res) => {
    const id = Number(req.params.id);
    const { grantee_type, grantee } = req.body as { grantee_type?: string; grantee?: string };
    if ((grantee_type !== "user" && grantee_type !== "role") || typeof grantee !== "string" || grantee.trim() === "") {
      return res.status(400).json({ error: "grantee_type ('user'|'role') and grantee are required." });
    }
    if (!getDashboard(id)) return res.status(404).json({ error: "Dashboard not found." });
    const actor = (req as AuthedRequest).user!.creds.username;
    const before = listDashboardGrants(id);
    const removed = removeDashboardGrant(id, grantee_type, grantee);
    const after = listDashboardGrants(id);
    if (removed) {
      emitRbacAudit(db, {
        actor,
        action: "dashboard_access_revoked",
        target: `dashboard:${id}:${grantee_type}:${grantee.trim().toLowerCase()}`,
        before_json: JSON.stringify(before),
        after_json: JSON.stringify(after),
      });
    }
    return res.json({ grants: after });
  });

  // Widget persistence
  // ENFORCE-V110-02: collapse access check into existing 404 guard (404, NOT 403 — hides existence).
  app.get("/api/dashboards/:id/widgets", (req, res) => {
    const id = Number(req.params.id);
    const username = (req as AuthedRequest).user!.creds.username;
    if (!getDashboard(id) || !canViewDashboard(username, id)) return res.status(404).json({ error: "Dashboard not found." });
    return res.json({ data: listWidgets(id) });
  });

  app.post("/api/dashboards/:id/widgets", ...requirePermission(PERMISSIONS.DASHBOARDS_EDIT), (req, res) => {
    const dashboardId = Number(req.params.id);
    if (!getDashboard(dashboardId)) return res.status(404).json({ error: "Dashboard not found." });
    const input = req.body as Omit<Widget, "id" | "dashboard_id" | "created_at" | "updated_at">;
    if (!input?.title || !input?.type) {
      return res.status(400).json({ error: "Widget requires 'title' and 'type'." });
    }
    const widget = createWidget(dashboardId, {
      title: input.title,
      type: input.type,
      position: input.position ?? 0,
      config: input.config ?? {}
    });
    return res.status(201).json(widget);
  });

  app.patch("/api/widgets/:id", ...requirePermission(PERMISSIONS.WIDGETS_CONFIGURE), (req, res) => {
    const id = Number(req.params.id);
    const updated = updateWidget(id, req.body);
    if (!updated) return res.status(404).json({ error: "Widget not found." });
    return res.json(updated);
  });

  app.delete("/api/widgets/:id", ...requirePermission(PERMISSIONS.DASHBOARDS_EDIT), (req, res) => {
    const id = Number(req.params.id);
    const ok = deleteWidget(id);
    if (!ok) return res.status(404).json({ error: "Widget not found." });
    return res.status(204).send();
  });

  // Dashboard-Table associations
  // ENFORCE-V110-02: collapse access check into existing 404 guard.
  app.get("/api/dashboards/:id/tables", (req, res) => {
    const id = Number(req.params.id);
    const username = (req as AuthedRequest).user!.creds.username;
    if (!getDashboard(id) || !canViewDashboard(username, id)) return res.status(404).json({ error: "Dashboard not found." });
    return res.json({ data: listDashboardTables(id) });
  });

  app.post("/api/dashboards/:id/tables", ...requirePermission(PERMISSIONS.DASHBOARDS_EDIT), (req, res) => {
    const dashboardId = Number(req.params.id);
    if (!getDashboard(dashboardId)) return res.status(404).json({ error: "Dashboard not found." });
    const { table_id } = req.body as { table_id?: number };
    if (!table_id) return res.status(400).json({ error: "table_id is required." });
    if (!getTable(table_id)) return res.status(404).json({ error: "Table not found." });
    addDashboardTable(dashboardId, table_id);
    return res.status(201).json({ data: listDashboardTables(dashboardId) });
  });

  app.delete("/api/dashboards/:dashboardId/tables/:tableId", ...requirePermission(PERMISSIONS.DASHBOARDS_EDIT), (req, res) => {
    const dashboardId = Number(req.params.dashboardId);
    const tableId = Number(req.params.tableId);
    const ok = removeDashboardTable(dashboardId, tableId);
    if (!ok) return res.status(404).json({ error: "Association not found." });
    return res.status(204).send();
  });

  // ─── Dashboard Layers (Phase 12) ──────────────────────────────────────────
  // PITFALL (RESEARCH Open Q1): reorder route MUST be registered BEFORE the
  // :layerId parameterised route. Express matches routes in registration order;
  // if reversed, "reorder" would be matched as the literal value of :layerId.

  // ENFORCE-V110-02: collapse access check into existing 404 guard.
  app.get("/api/dashboards/:id/layers", (req, res) => {
    const id = Number(req.params.id);
    const username = (req as AuthedRequest).user!.creds.username;
    if (!getDashboard(id) || !canViewDashboard(username, id)) return res.status(404).json({ error: "Dashboard not found." });
    return res.json({ data: listDashboardLayers(id) });
  });

  app.post("/api/dashboards/:id/layers", ...requirePermission(PERMISSIONS.LAYERS_MANAGE), (req, res) => {
    const dashboardId = Number(req.params.id);
    if (!getDashboard(dashboardId)) return res.status(404).json({ error: "Dashboard not found." });
    const { table_id, layer_type, position, config } = req.body as {
      table_id?: number; layer_type?: "KineticaWms"; position?: number; config?: Record<string, unknown>;
    };
    if (typeof table_id !== "number") {
      return res.status(400).json({ error: "table_id (number) is required." });
    }
    if (layer_type !== undefined && layer_type !== "KineticaWms") {
      return res.status(400).json({ error: "layer_type must be 'KineticaWms'." });
    }
    const layer = createDashboardLayer(dashboardId, { table_id, layer_type, position, config });
    return res.status(201).json(layer);
  });

  // REORDER — must precede :layerId
  app.patch("/api/dashboards/:id/layers/reorder", ...requirePermission(PERMISSIONS.LAYERS_MANAGE), (req, res) => {
    const dashboardId = Number(req.params.id);
    if (!getDashboard(dashboardId)) return res.status(404).json({ error: "Dashboard not found." });
    const { orderedIds } = req.body as { orderedIds?: number[] };
    if (!Array.isArray(orderedIds) || orderedIds.some((n) => typeof n !== "number")) {
      return res.status(400).json({ error: "orderedIds (number[]) is required." });
    }
    try {
      const layers = reorderDashboardLayers(dashboardId, orderedIds);
      return res.json({ data: layers });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "reorder failed";
      return res.status(400).json({ error: msg });
    }
  });

  app.patch("/api/dashboards/:id/layers/:layerId", ...requirePermission(PERMISSIONS.LAYERS_MANAGE), (req, res) => {
    const layerId = Number(req.params.layerId);
    // v1.4 Phase 19 (CONFIG-V14-01): pass-through forwarding of info_enabled / info_columns /
    // info_template alongside existing table_id / position / config. No strict validation here —
    // Phase 22 UI will validate; Phase 19 keeps the existing pass-through pattern.
    // v1.6 Phase 35 (DV-V16-13): additionally forwards dynamic_view_id (number | null) — same
    // pass-through trust model (frontend picker constructs an integer, server forwards verbatim).
    // v1.7 Phase 38 (SCHEMA-V17-02): additionally forwards cb_config + track_config JSON strings.
    // Same trust model as info_* / dynamic_view_id — frontend constructs / validates the JSON
    // string; server forwards verbatim to updateDashboardLayer. Phase 39 form UI does client-side
    // validation; server validation intentionally absent (Kinetica accepts permissive CB_VALS
    // shapes per Phase 37 OQ-4).
    const body = req.body as Partial<Pick<DashboardLayer,
      | "table_id"
      | "position"
      | "config"
      | "info_enabled"
      | "info_columns"
      | "info_template"
      | "dynamic_view_id"
      // v1.7 Phase 38 (SCHEMA-V17-02): classbreak + track config JSON pass-through.
      // Same trust model as info_* / dynamic_view_id — frontend constructs / validates
      // the JSON string; server forwards verbatim to updateDashboardLayer. Phase 39 form
      // UI does client-side Zod-free validation; Kinetica accepts permissive CB_VALS
      // shapes (Phase 37 OQ-4) so server validation is intentionally absent.
      | "cb_config"
      | "track_config"
    >>;
    const updated = updateDashboardLayer(layerId, body);
    if (!updated) return res.status(404).json({ error: "Layer not found." });
    return res.json(updated);
  });

  app.delete("/api/dashboards/:id/layers/:layerId", ...requirePermission(PERMISSIONS.LAYERS_MANAGE), (req, res) => {
    const layerId = Number(req.params.layerId);
    const ok = deleteDashboardLayer(layerId);
    if (!ok) return res.status(404).json({ error: "Layer not found." });
    return res.status(204).send();
  });

  // Dashboard-Table Views
  // ENFORCE-V110-02: collapse access check into existing 404 guard.
  app.get("/api/dashboards/:id/views", (req, res) => {
    const id = Number(req.params.id);
    const username = (req as AuthedRequest).user!.creds.username;
    if (!getDashboard(id) || !canViewDashboard(username, id)) return res.status(404).json({ error: "Dashboard not found." });
    return res.json({ data: listViews(id) });
  });

  app.post("/api/dashboards/:id/views", ...requirePermission(PERMISSIONS.DASHBOARDS_EDIT), (req, res) => {
    const dashboardId = Number(req.params.id);
    if (!getDashboard(dashboardId)) return res.status(404).json({ error: "Dashboard not found." });
    const { table_id, view_name, filter_clause } = req.body as {
      table_id?: number;
      view_name?: string;
      filter_clause?: string;
    };
    if (!table_id || !view_name) {
      return res.status(400).json({ error: "table_id and view_name are required." });
    }
    if (!getTable(table_id)) return res.status(404).json({ error: "Table not found." });
    const view = createView(dashboardId, table_id, view_name, filter_clause ?? "");
    return res.status(201).json(view);
  });

  app.patch("/api/views/:id", ...requirePermission(PERMISSIONS.DASHBOARDS_EDIT), (req, res) => {
    const id = Number(req.params.id);
    const { filter_clause } = req.body as { filter_clause?: string };
    if (filter_clause === undefined) return res.status(400).json({ error: "filter_clause is required." });
    const updated = updateViewFilter(id, filter_clause);
    if (!updated) return res.status(404).json({ error: "View not found." });
    return res.json(updated);
  });

  app.delete("/api/views/:id", ...requirePermission(PERMISSIONS.DASHBOARDS_EDIT), (req, res) => {
    const id = Number(req.params.id);
    const view = getView(id);
    if (!view) return res.status(404).json({ error: "View not found." });
    deleteView(id);
    return res.status(204).send();
  });

  // Create (or recreate) the materialized view on Kinetica
  // PHASE 3 NOTE: Materialize keeps its try/catch because it must call updateViewStatus("error")
  // as a side effect on every failure path (status persistence). The catch block does the side
  // effect, then forwards via next(err) so the middleware translates the HTTP response.
  // (CONTEXT.md §"Single exception: materialize")
  app.post("/api/views/:id/materialize", requireConfig, ...requirePermission(PERMISSIONS.DASHBOARDS_EDIT), asyncHandler(async (req, res, next) => {
    const id = Number(req.params.id);
    const view = getView(id);
    if (!view) return res.status(404).json({ error: "View not found." });

    const table = getTable(view.table_id);
    if (!table) return res.status(404).json({ error: "Source table not found." });

    const sourceTable = table.schema ? `${table.schema}.${table.name}` : table.name;
    const whereClause = view.filter_clause?.trim() ? ` WHERE ${view.filter_clause}` : "";
    const ddl = `CREATE OR REPLACE MATERIALIZED VIEW ${view.view_name} AS SELECT * FROM ${sourceTable}${whereClause}`;

    try {
      await kineticaSqlHelper(req as AuthedRequest, ddl, {
        route: "POST /api/views/:id/materialize",
        op: "MATERIALIZE",
        extra: { limit: 1 },
      });
      const updated = updateViewStatus(id, "created");
      return res.json({ view: updated, ddl });
    } catch (err) {
      // PRESERVE: persist view status="error" with the error message before forwarding.
      // Middleware sends the 401/403/502 response; route is responsible for the side effect.
      if (
        err instanceof KineticaAuthError ||
        err instanceof KineticaPermissionError ||
        err instanceof KineticaUpstreamError
      ) {
        updateViewStatus(id, "error", err.message);
      } else {
        // Defensive: unexpected non-typed error — still persist as error.
        updateViewStatus(id, "error", "Failed to materialize view");
      }
      return next(err);
    }
  }));

  // ═══════════════════════════════════════════════════════════════════════════════
  // ANALYST-PASSTHROUGH BOUNDARY (GUARD-V18-03)
  // ═══════════════════════════════════════════════════════════════════════════════
  //
  // Routes below this comment are gated by requireAuth ONLY — NO requirePermission.
  // These are the "analyst interaction" routes: every authenticated user can reach
  // them regardless of their assigned role or the analyst-passthrough fallback.
  //
  // WHY each route is here:
  //   POST /api/filter/materialize   — click-through drill-down; the core product value.
  //                                    Session-scoped view name (username+sid) prevents
  //                                    cross-user leakage. Gating this on ANY write
  //                                    permission breaks the analyst role entirely.
  //   DELETE /api/filter/materialize — analyst clears their own session filter.
  //   POST /api/dynamic-view/materialize — fires on every filter change for widgets
  //                                    bound to a dynamic view; analysts trigger this.
  //   POST /api/dynamic-view/:id/drop — lifecycle cleanup at logout/dashboard-switch;
  //                                    called automatically, not by user intent.
  //                                    DISTINCT from DELETE /api/dynamic-view/:id which
  //                                    deletes the saved config and requires DYNAMIC_VIEWS_MANAGE.
  //   POST /api/dynamic-view/preview — reads data only; no persistent resource created.
  //                                    Designer surface (DynamicViewsModal) but auth-only
  //                                    route since it performs no writes.
  //   POST /api/info/query           — spatial nearest-neighbor read; map popup interaction.
  //   POST /api/top-values           — column cardinality probe for Data Filter widget dropdowns.
  //   POST /api/column-stats         — chart config column stats; visible to all roles.
  //   POST /api/quantile             — NTILE query backing class-break auto-suggest.
  //   POST /api/sql                  — general Kinetica passthrough for all widget renders.
  //                                    DATA ACCESS enforced by Kinetica per-user creds.
  //   GET  /api/wms                  — map tile proxy; analyst views maps.
  //   GET  /api/wms/capabilities     — WMS metadata; all roles may view maps.
  //   GET  /api/kinetica/*           — schema/table/column discovery; auth-only per CONTEXT.
  //   GET  /api/tables               — app table registry reads.
  //   GET  /api/tables/:id           — single table read.
  //
  // If adding a new route, ask: "Can an analyst (dashboards:view only) need this?"
  //   YES → place here with requireAuth (or requireAuth + requireConfig) only.
  //   NO  → place in the guarded section with requirePermission(...).
  // ═══════════════════════════════════════════════════════════════════════════════

  // ----- v1.3 Phase 13: Filter materialize (transient, session-scoped) -----
  // POST /api/filter/materialize — apply filters by creating/replacing a transient materialized view.
  // DELETE /api/filter/materialize — clear filters by dropping the transient view.
  //
  // Differences from /api/views/:id/materialize (the persisted view CRUD endpoint above):
  //   - Server is stateless re views (no SQLite reads/writes; Kinetica TTL=5 is sole cleanup)
  //   - View name is composed from session context (user, session, dashboard, table), not read from a row
  //   - WHERE clause is built server-side from request body filters (VIEW-V13-06)
  //   - NO try/catch — typed errors bubble through asyncHandler → errorMiddleware (no side effects to persist)
  //
  // V13-P-08: Username sanitization happens inside buildFilterViewName (lib/viewNaming.ts).
  // CONTEXT.md decisions § View-name details: shape is _kbi_filt_u<userId>_d<dashId>_t<tableId>_s<sessionShort>.
  // S4 outcome: BOTH qualified and unqualified WMS LAYERS forms work — endpoint returns the
  // UNQUALIFIED bare view name (no schema lookup needed; Plan 13-02 builder takes no schema param).

  app.post("/api/filter/materialize", requireConfig, asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as {
      dashboardId?: number;
      tableId?: number;
      filters?: ActiveFilter[];
      spatialFilters?: SpatialFilter[];
      spatialTarget?: SpatialTarget;
    };
    const {
      dashboardId,
      tableId,
      filters = [],
      spatialFilters,
      spatialTarget,
    } = body;

    // ── Validation step 1: dashboardId / tableId numeric (existing v1.3 check) ──
    if (typeof dashboardId !== "number" || typeof tableId !== "number") {
      return res.status(400).json({ error: "dashboardId and tableId are required numbers." });
    }

    // Defensive: coerce filters to [] when caller sends null / undefined / non-array.
    // The default-value destructuring above handles `undefined` but not `null`.
    const filtersArr: ActiveFilter[] = Array.isArray(filters) ? filters : [];
    const hasFilters = filtersArr.length > 0;
    const hasSpatial = Array.isArray(spatialFilters) && spatialFilters.length > 0;

    // ── Validation step 2: empty input (BOTH column AND spatial absent/empty) ──
    // v1.3 backward compat: filters-only callers still pass through. Spatial-only callers
    // (filters: [] + spatialFilters: [...] + spatialTarget: {...}) also pass through.
    if (!hasFilters && (!hasSpatial || !spatialTarget)) {
      return res.status(400).json({
        error: "filters or (spatialFilters + spatialTarget) must be non-empty (use DELETE to clear).",
      });
    }

    // ── Validation step 3: pair-completeness (spatialFilters ↔ spatialTarget) ──
    // The Phase 30 client always emits both together; reject mismatched halves.
    if (hasSpatial && !spatialTarget) {
      return res.status(400).json({ error: "spatialTarget is required when spatialFilters are provided." });
    }
    if (spatialTarget && !hasSpatial) {
      return res.status(400).json({ error: "spatialFilters are required when spatialTarget is provided." });
    }

    // ── Validation step 4: spatialTarget.tableId must match body.tableId ──
    if (spatialTarget && spatialTarget.tableId !== tableId) {
      return res.status(400).json({
        error: "spatialTarget.tableId must match body.tableId.",
      });
    }

    // ── Validation step 5: WKB mode 501 early-return (BEFORE composeWhereClause) ──
    // Mirrors Phase 18 intent at index.ts:776-783. The throwing stub in
    // spatialWhereClause.ts is a static guarantee; this early-return is the
    // production code path. TD-V14-WKB-SPIKE carry-forward.
    if (spatialTarget?.spatialMode === "wkb") {
      return res.status(501).json({
        error: "WKB mode deferred",
        td: "TD-V14-WKB-SPIKE",
      });
    }

    // ── Table lookup ────────────────────────────────────────────────────
    const table = getTable(tableId);
    if (!table) return res.status(404).json({ error: "Table not found." });
    const tableRef = table.schema ? `${table.schema}.${table.name}` : table.name;

    const authedReq = req as AuthedRequest;
    const viewName = buildFilterViewName({
      username: authedReq.user!.creds.username,
      sessionId: authedReq.user!.sid,
      dashboardId,
      tableId,
    });

    // ── Compose WHERE: spatial OR-chain AND'd with column AND-chain ─────
    const whereClause = composeWhereClause(
      filtersArr,
      spatialFilters ?? [],
      spatialTarget ?? null,
    );
    // Phase 32 Plan 01: extracted to lib/materializedView.ts so dynamic-view
    // materialize (Plan 03) shares the same Kinetica race-recovery retry.
    // CONTEXT.md § D5: same retry pattern across filter-view and dynamic-view.
    // Happy path remains a single CREATE OR REPLACE; on the specific race
    // ('Could not find the table' from Kinetica's internal drop step) the
    // helper retries with DROP IF EXISTS + plain CREATE.
    await createOrReplaceMaterialized({
      req: authedReq,
      view: viewName,
      sqlBody: `SELECT * FROM ${tableRef} WHERE ${whereClause}`,
      ttl: 5,
      route: "POST /api/filter/materialize",
      op: "MATERIALIZE",
    });

    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes (sliding TTL)
    return res.json({ viewName, expiresAt });
  }));

  app.delete("/api/filter/materialize", requireConfig, asyncHandler(async (req, res) => {
    const dashboardId = Number(req.query.dashboardId);
    const tableId = Number(req.query.tableId);

    if (!Number.isFinite(dashboardId) || !Number.isFinite(tableId)) {
      return res.status(400).json({ error: "dashboardId and tableId query params are required numbers." });
    }

    const authedReq = req as AuthedRequest;
    const viewName = buildFilterViewName({
      username: authedReq.user!.creds.username,
      sessionId: authedReq.user!.sid,
      dashboardId,
      tableId,
    });

    await kineticaSqlHelper(authedReq, `DROP TABLE IF EXISTS ${viewName}`, {
      route: "DELETE /api/filter/materialize",
      op: "MATERIALIZE",
    });

    return res.json({ dropped: true });
  }));

  // ===== v1.7 Phase 38 (SCHEMA-V17-06): POST /api/quantile =====
  // NTILE bucket-MIN quantile query backing Phase 39 Auto-suggest classbreak boundaries.
  // Per-user Kinetica passthrough via kineticaSql (same auth + audit pipeline as
  // /api/filter/materialize + /api/dynamic-view/*). No caching (single round-trip per
  // operator click — see 38-CONTEXT.md § /api/quantile endpoint contract).
  //
  // SQL template locked verbatim from .planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md
  // ## Decision § NTILE syntax locked (PARTITION BY 0 form + bucket-MIN wrapper).
  //
  // AUTH_MODE-agnostic — works under both password and OIDC modes via the existing
  // kineticaSql credential-type branch.
  app.post("/api/quantile", requireConfig, asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as {
      schema?: unknown;
      table?: unknown;
      column?: unknown;
      n?: unknown;
    };

    // Validation step 1: schema/table/column must be non-empty strings
    if (
      typeof body.schema !== "string" ||
      typeof body.table !== "string" || body.table.length === 0 ||
      typeof body.column !== "string" || body.column.length === 0
    ) {
      // schema may be an empty string when the caller is querying an unprefixed
      // identifier (e.g. a dynamic view's materialized view name) — table+column remain required.
      return res.status(400).json({ error: "table + column required as non-empty strings; schema may be empty." });
    }

    // Validation step 2: n must be an integer in [2, 256] (Phase 11 cardinality cap)
    if (
      typeof body.n !== "number" ||
      !Number.isInteger(body.n) ||
      body.n < 2 ||
      body.n > 256
    ) {
      return res.status(400).json({ error: "n must be integer in [2, 256]." });
    }

    const { schema, table, column, n } = body as {
      schema: string;
      table: string;
      column: string;
      n: number;
    };

    // Build the locked NTILE SQL via the pure lib module + run via per-user kineticaSql.
    // Kinetica permission / upstream / column-not-found / non-numeric-column errors bubble
    // through asyncHandler → errorMiddleware unchanged (typed-error middleware handles them).
    const sql = buildQuantileSql({ schema, table, column, n });
    const authedReq = req as AuthedRequest;
    const encoded = await kineticaSqlHelper(authedReq, sql, {
      route: "POST /api/quantile",
      op: "QUANTILE",
    });

    // Parse Kinetica's bucket-MIN columnar response → drop bucket 1's MIN → return N-1 breaks.
    const breaks = parseQuantileResponse(encoded);
    return res.json({ breaks });
  }));

  // POST /api/top-values — top-N distinct values by frequency (GROUP BY + COUNT(*)),
  // backing categorical Auto-suggest in the Class Break form and Data Filter dropdowns.
  // Same auth + audit pipeline as /api/quantile; per-user kineticaSql passthrough; AUTH_MODE-agnostic.
  app.post("/api/top-values", requireConfig, asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as {
      schema?: unknown;
      table?: unknown;
      column?: unknown;
      n?: unknown;
    };

    if (
      typeof body.schema !== "string" ||
      typeof body.table !== "string" || body.table.length === 0 ||
      typeof body.column !== "string" || body.column.length === 0
    ) {
      // schema may be an empty string when the caller is querying an unprefixed
      // identifier (e.g. a dynamic view's materialized view name) — table+column remain required.
      return res.status(400).json({ error: "table + column required as non-empty strings; schema may be empty." });
    }

    if (
      typeof body.n !== "number" ||
      !Number.isInteger(body.n) ||
      body.n < 2 ||
      body.n > 1000
    ) {
      // Phase 44 (FILTER-V17-06): cap raised from 256 → 1000 for Data Filter widget dropdown population.
      // Server cost bounded by Kinetica `GROUP BY ... LIMIT 1000`.
      return res.status(400).json({ error: "n must be integer in [2, 1000]." });
    }

    const { schema, table, column, n } = body as {
      schema: string;
      table: string;
      column: string;
      n: number;
    };

    const sql = buildTopValuesSql({ schema, table, column, n });
    const authedReq = req as AuthedRequest;
    const encoded = await kineticaSqlHelper(authedReq, sql, {
      route: "POST /api/top-values",
      op: "TOP_VALUES",
    });

    const values = parseTopValuesResponse(encoded);
    return res.json({ values });
  }));

  // POST /api/column-stats — MIN/MAX/AVG/STDDEV for a numeric column, backing the
  // Equal-Interval + Standard-Deviation classification methods (client computes the
  // break boundaries from these stats). Same pipeline as /api/quantile.
  app.post("/api/column-stats", requireConfig, asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as {
      schema?: unknown;
      table?: unknown;
      column?: unknown;
    };

    if (
      typeof body.schema !== "string" ||
      typeof body.table !== "string" || body.table.length === 0 ||
      typeof body.column !== "string" || body.column.length === 0
    ) {
      // schema may be an empty string when the caller is querying an unprefixed
      // identifier (e.g. a dynamic view's materialized view name) — table+column remain required.
      return res.status(400).json({ error: "table + column required as non-empty strings; schema may be empty." });
    }

    const { schema, table, column } = body as { schema: string; table: string; column: string };
    const sql = buildColumnStatsSql({ schema, table, column });
    const authedReq = req as AuthedRequest;
    const encoded = await kineticaSqlHelper(authedReq, sql, {
      route: "POST /api/column-stats",
      op: "COLUMN_STATS",
    });

    const stats = parseColumnStatsResponse(encoded);
    return res.json(stats);
  }));

  // ===== v1.6 Phase 32 Plan 02: Dynamic Views CRUD (DV-V16-01) =====
  // CONTEXT.md § "CRUD (round-out)": list / create / update only.
  // Preview / materialize / delete live in Plan 03 (separate route surface
  // — appended below this block; do not interleave handlers).
  //
  // Validation pattern: at create + update time, call substituteViewToken with
  // a dummy view name to detect MissingViewTokenError BEFORE persistence.
  // This guarantees the DB never holds a template that materialize cannot run.
  // CONTEXT.md § D1: "{view} absent → 400, configuration error not runtime degrade".
  //
  // INSERTION ANCHOR (for Plan 03): Plan 03 routes MUST be appended AFTER the
  // closing of the PUT /api/dynamic-views/:id handler below and BEFORE the
  // "v1.4 Phase 18: Map info popup spatial query" block. Routes added by
  // Plan 03 use disjoint paths (/api/dynamic-view/preview, /api/dynamic-view/materialize,
  // /api/dynamic-view/:id with DELETE method) so the two plans share only this
  // route-registration region — no handler-body conflict possible.

  // ENFORCE-V110-02: dynamic-views GET previously had NO getDashboard guard. Add both
  // getDashboard and canViewDashboard checks here so denial is 404 (existence hidden).
  app.get(
    "/api/dashboards/:dashboardId/dynamic-views",
    requireConfig,
    asyncHandler(async (req, res) => {
      const dashboardId = Number(req.params.dashboardId);
      if (!Number.isFinite(dashboardId)) {
        return res.status(400).json({ error: "dashboardId path param must be numeric." });
      }
      const username = (req as AuthedRequest).user!.creds.username;
      if (!getDashboard(dashboardId) || !canViewDashboard(username, dashboardId)) {
        return res.status(404).json({ error: "Dashboard not found." });
      }
      const rows = listDashboardDynamicViews(dashboardId);
      return res.json({ dynamic_views: rows });
    })
  );

  app.post(
    "/api/dashboards/:dashboardId/dynamic-views",
    requireConfig,
    ...requirePermission(PERMISSIONS.DYNAMIC_VIEWS_MANAGE),
    asyncHandler(async (req, res) => {
      const dashboardId = Number(req.params.dashboardId);
      if (!Number.isFinite(dashboardId)) {
        return res.status(400).json({ error: "dashboardId path param must be numeric." });
      }
      const body = (req.body ?? {}) as {
        source_table_id?: number;
        name?: string;
        template_sql?: string;
        max_records?: number;
        // Phase 34 post-VERIFY fix: accept optional columns_json on CREATE. The Phase 34 modal
        // sends this when the operator ran Preview successfully before clicking Save. The original
        // BLOCKER #1 fix prevented sending columns_json on edit-without-Preview, but inadvertently
        // also blocked the Preview→Save→create flow — leaving columns_json null forever and breaking
        // downstream consumers (Phase 35 ChartConfigPanel column pickers, LayersModal column lists).
        columns_json?: { name: string; type: string }[] | null;
      };
      // Field validation (all four are required at create time; columns_json is optional).
      if (typeof body.source_table_id !== "number") {
        return res.status(400).json({ error: "source_table_id is required and must be a number." });
      }
      if (typeof body.name !== "string" || body.name.trim() === "") {
        return res.status(400).json({ error: "name is required and must be a non-empty string." });
      }
      if (typeof body.template_sql !== "string" || body.template_sql.trim() === "") {
        return res.status(400).json({ error: "template_sql is required and must be a non-empty string." });
      }
      // max_records: 0 means UNLIMITED (no row cap — materialize regardless of count).
      // Any positive number is a cap; negatives are invalid.
      if (typeof body.max_records !== "number" || body.max_records < 0) {
        return res.status(400).json({ error: "max_records is required and must be 0 (unlimited) or a positive number." });
      }
      // CONTEXT.md § D1: template must contain {view} token. substituteViewToken throws on absence.
      try {
        substituteViewToken(body.template_sql, "_dummy_validation_view_name_");
      } catch (err) {
        if (err instanceof MissingViewTokenError) {
          return res.status(400).json({ error: err.message });
        }
        throw err;
      }
      // columns_json acceptance (post-VERIFY): when caller supplies it (Preview-then-Save flow),
      // persist it. When omitted, default null (legacy callers + CreateView-without-Preview path).
      // Shape validation mirrors PUT handler at lines 958-970 (array of { name: string, type: string }).
      let columnsJsonOnCreate: { name: string; type: string }[] | null = null;
      if ("columns_json" in body && body.columns_json !== undefined) {
        if (body.columns_json === null) {
          columnsJsonOnCreate = null;
        } else if (
          Array.isArray(body.columns_json) &&
          body.columns_json.every(
            (c) =>
              c !== null &&
              typeof c === "object" &&
              typeof (c as { name?: unknown }).name === "string" &&
              typeof (c as { type?: unknown }).type === "string",
          )
        ) {
          columnsJsonOnCreate = body.columns_json;
        } else {
          return res.status(400).json({ error: "columns_json must be null or an array of { name: string, type: string }." });
        }
      }
      const row = createDashboardDynamicView(dashboardId, {
        source_table_id: body.source_table_id,
        name: body.name,
        template_sql: body.template_sql,
        max_records: body.max_records,
        columns_json: columnsJsonOnCreate,
      });
      return res.status(201).json({ dynamic_view: row });
    })
  );

  app.put(
    "/api/dynamic-views/:id",
    requireConfig,
    ...requirePermission(PERMISSIONS.DYNAMIC_VIEWS_MANAGE),
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "id path param must be numeric." });
      }
      const existing = getDashboardDynamicView(id);
      if (!existing) {
        return res.status(404).json({ error: "Dynamic view not found." });
      }
      const body = (req.body ?? {}) as {
        source_table_id?: number;
        name?: string;
        template_sql?: string;
        max_records?: number;
        columns_json?: { name: string; type: string }[] | null;
      };
      // If template_sql is being updated, validate the new SQL contains {view}.
      if (typeof body.template_sql === "string") {
        if (body.template_sql.trim() === "") {
          return res.status(400).json({ error: "template_sql must be a non-empty string when provided." });
        }
        try {
          substituteViewToken(body.template_sql, "_dummy_validation_view_name_");
        } catch (err) {
          if (err instanceof MissingViewTokenError) {
            return res.status(400).json({ error: err.message });
          }
          throw err;
        }
      }
      // CONTEXT.md § D3: when template_sql changes, columns_json MUST be cleared.
      // Operator must run Preview again before the next Save populates columns_json afresh.
      // If the caller explicitly supplies columns_json in the same request body, the caller's
      // value wins (Plan 34 flow: Preview returns new columns, UI sends template_sql +
      // columns_json together on Save). If the caller omits columns_json but updates template_sql,
      // we clear it.
      let columnsJsonAttr: { name: string; type: string }[] | null | undefined;
      if ("columns_json" in body) {
        columnsJsonAttr = body.columns_json ?? null;
      } else if (
        typeof body.template_sql === "string" &&
        body.template_sql !== existing.template_sql
      ) {
        columnsJsonAttr = null;
      } else {
        columnsJsonAttr = undefined; // omit — preserve existing
      }
      const attrs: Partial<{
        source_table_id: number;
        name: string;
        template_sql: string;
        max_records: number;
        columns_json: { name: string; type: string }[] | null;
      }> = {};
      if (typeof body.source_table_id === "number") attrs.source_table_id = body.source_table_id;
      if (typeof body.name === "string") attrs.name = body.name;
      if (typeof body.template_sql === "string") attrs.template_sql = body.template_sql;
      if (typeof body.max_records === "number" && body.max_records >= 0) attrs.max_records = body.max_records;
      if (columnsJsonAttr !== undefined) attrs.columns_json = columnsJsonAttr;

      const updated = updateDashboardDynamicView(id, attrs);
      return res.json({ dynamic_view: updated });
    })
  );
  // ===== End Phase 32 Plan 02 — Plan 03 routes append after this line =====

  // ===== v1.6 Phase 32 Plan 03: Dynamic Views runtime endpoints =====
  // DV-V16-03 preview, DV-V16-04 materialize, DV-V16-05 delete.
  //
  // CONTEXT.md locked decisions wired here:
  //   - D1: substituteViewToken (case-insensitive, whitespace-tolerant, throws on absence)
  //   - D2: no filter view → return over_threshold + drop dynamic view
  //   - D5: TM/SMc:1078 retry — delegated to createOrReplaceMaterialized helper
  //   - D6: TTL=5 minutes on materialized dynamic view
  //   - D7: buildDynamicViewName produces `_kbi_dv_u<userId>_d<dashboardId>_<dynamicViewId>`
  //
  // Architectural note (deviation from PLAN.md — see SUMMARY.md):
  //   The original plan attempted to detect "active filter view" via a
  //   `dashboard_table_views` row with `status === "ready"`. That status value
  //   doesn't exist (DashboardTableView.status is "pending" | "created" | "error")
  //   AND, more fundamentally, the session-scoped filter views produced by
  //   `POST /api/filter/materialize` are NEVER inserted into dashboard_table_views
  //   — they live exclusively as Kinetica materialized views with deterministic
  //   names built by buildFilterViewName(). So the only authoritative existence
  //   check is a Kinetica round-trip. We use the COUNT(*) probe (which we need
  //   anyway for the materialize threshold gate) and treat "Could not find the
  //   table" (TM/SMc:1078 family) as the no_filter signal. For Preview, we use a
  //   single SELECT 1 probe up-front to choose between filter-view and
  //   bare-table substitution.

  // ---- Helper: detect "table-not-found" errors from Kinetica ---------------
  // Same matcher used by createOrReplaceMaterialized's race-recovery path
  // (lib/materializedView.ts § isReplaceRace). Centralising the regex here
  // keeps the two consumers in sync.
  const isTableNotFoundError = (err: unknown): boolean => {
    const msg = (err as Error)?.message ?? "";
    // Kinetica returns several distinct error codes for "object/table doesn't exist"
    // depending on which subsystem hit the miss:
    //   - TM/SMc:1078: Table Manager / Schema Memory miss (filter-view CREATE OR REPLACE
    //     race; persistent table lookup).
    //   - S/SDc:1513: Schema / Schema Database error 1513 — typical for SELECT against a
    //     materialized-view that doesn't exist (the no-filter-yet case for Preview/
    //     materialize probes). Surfaced as: "Object '<name>' not found (S/SDc:1513)".
    //   - Bare "Object '<name>' not found" / "Could not find the table" prose for
    //     defense-in-depth across Kinetica versions that may not include a code suffix.
    return (
      msg.includes("TM/SMc:1078") ||
      msg.includes("S/SDc:1513") ||
      /Could not find the table/i.test(msg) ||
      /Object\s+'[^']*'\s+not\s+found/i.test(msg)
    );
  };

  // POST /api/dynamic-view/preview — one-shot read; does NOT create a permanent view.
  app.post(
    "/api/dynamic-view/preview",
    requireConfig,
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as {
        template_sql?: string;
        source_table_id?: number;
        dashboard_id?: number;
        sample_limit?: number;
      };
      if (typeof body.template_sql !== "string" || body.template_sql.trim() === "") {
        return res.status(400).json({ error: "template_sql is required and must be a non-empty string." });
      }
      if (typeof body.source_table_id !== "number") {
        return res.status(400).json({ error: "source_table_id is required and must be a number." });
      }
      if (typeof body.dashboard_id !== "number") {
        return res.status(400).json({ error: "dashboard_id is required and must be a number." });
      }
      // Clamp sample_limit to [1, 1000] (1000 caps Preview cost; default 100 matches CONTEXT.md endpoint example).
      const sampleLimit = typeof body.sample_limit === "number" && body.sample_limit > 0
        ? Math.min(body.sample_limit, 1000)
        : 100;

      const table = getTable(body.source_table_id);
      if (!table) {
        return res.status(404).json({ error: "Source table not found." });
      }
      const sourceTableRef = table.schema ? `${table.schema}.${table.name}` : table.name;

      const authedReq = req as AuthedRequest;
      const expectedFilterViewName = buildFilterViewName({
        username: authedReq.user!.creds.username,
        sessionId: authedReq.user!.sid,
        dashboardId: body.dashboard_id,
        tableId: body.source_table_id,
      });

      // Probe Kinetica for the session-scoped filter view. If it exists, use
      // its name as the {view} substitution; otherwise fall back to the bare
      // source-table reference so operators can develop SQL without first
      // applying a filter (CONTEXT.md § Preview).
      let sourceForSubstitution: string;
      try {
        await kineticaSqlHelper(
          authedReq,
          `SELECT 1 FROM ${expectedFilterViewName} LIMIT 0`,
          { route: "POST /api/dynamic-view/preview", op: "DYNAMIC_PREVIEW" },
        );
        sourceForSubstitution = expectedFilterViewName;
      } catch (err) {
        if (isTableNotFoundError(err)) {
          sourceForSubstitution = sourceTableRef;
        } else {
          throw err;
        }
      }

      // CONTEXT.md § D1: substituteViewToken throws MissingViewTokenError if {view} is absent.
      let substituted: string;
      try {
        substituted = substituteViewToken(body.template_sql, sourceForSubstitution);
      } catch (err) {
        if (err instanceof MissingViewTokenError) {
          return res.status(400).json({ error: err.message });
        }
        throw err;
      }

      const previewSql = `SELECT * FROM (${substituted}) LIMIT ${sampleLimit}`;
      const result = (await kineticaSqlHelper(authedReq, previewSql, {
        route: "POST /api/dynamic-view/preview",
        op: "DYNAMIC_PREVIEW",
      })) as Record<string, unknown> | null;

      // Kinetica returns column-major: { column_headers: string[], column_1, column_2, ... }
      // Mirrors the convention used by POST /api/info/query and the discovery routes.
      // Re-pack to row-major for the response.
      const columnNames: string[] = Array.isArray((result as { column_headers?: unknown })?.column_headers)
        ? ((result as { column_headers: string[] }).column_headers)
        : [];
      // Kinetica's standard /execute/sql encoded response does NOT include column types
      // (verified by reading existing consumers — info-query, discovery routes — and
      // kinetica.ts unwrap). We default `type` to "unknown" so the response shape stays
      // stable for Plan 35's ChartConfigPanel; types can be inferred client-side from
      // the sampled values if needed. If a future Kinetica response variant adds
      // `column_datatypes`, the decoder picks it up transparently.
      const columnTypes: string[] = Array.isArray((result as { column_datatypes?: unknown })?.column_datatypes)
        ? ((result as { column_datatypes: string[] }).column_datatypes)
        : [];
      const firstCol = columnNames.length > 0
        ? ((result as Record<string, unknown>)[`column_1`] as unknown[] | undefined)
        : undefined;
      const rowCount = Array.isArray(firstCol) ? firstCol.length : 0;
      const rows: unknown[][] = [];
      for (let i = 0; i < rowCount; i++) {
        const row: unknown[] = [];
        for (let c = 0; c < columnNames.length; c++) {
          const colArr = (result as Record<string, unknown>)[`column_${c + 1}`] as unknown[] | undefined;
          row.push(colArr ? colArr[i] : null);
        }
        rows.push(row);
      }
      const columns = columnNames.map((name, i) => ({ name, type: columnTypes[i] ?? "unknown" }));

      return res.json({ rows, columns });
    })
  );

  // POST /api/dynamic-view/materialize — threshold-gated CREATE OR REPLACE.
  app.post(
    "/api/dynamic-view/materialize",
    requireConfig,
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as { dynamic_view_id?: number };
      if (typeof body.dynamic_view_id !== "number") {
        return res.status(400).json({ error: "dynamic_view_id is required and must be a number." });
      }
      const row = getDashboardDynamicView(body.dynamic_view_id);
      if (!row) {
        return res.status(404).json({ error: "Dynamic view not found." });
      }
      const table = getTable(row.source_table_id);
      if (!table) {
        return res.status(404).json({ error: "Source table not found." });
      }
      const authedReq = req as AuthedRequest;
      const dynamicViewName = buildDynamicViewName({
        userId: authedReq.user!.creds.username,
        dashboardId: row.dashboard_id,
        dynamicViewId: row.id,
      });
      const expectedFilterViewName = buildFilterViewName({
        username: authedReq.user!.creds.username,
        sessionId: authedReq.user!.sid,
        dashboardId: row.dashboard_id,
        tableId: row.source_table_id,
      });

      // Decode a column-major COUNT(*) result. Kinetica returns column_1: [N].
      const decodeCount = (result: Record<string, unknown> | null): number => {
        const col = result?.["column_1"] as unknown[] | undefined;
        const cell = Array.isArray(col) ? col[0] : undefined;
        return typeof cell === "number" ? cell : typeof cell === "string" ? Number(cell) : 0;
      };
      const dropStale = () =>
        kineticaSqlHelper(authedReq, `DROP TABLE IF EXISTS ${dynamicViewName}`, {
          route: "POST /api/dynamic-view/materialize",
          op: "DYNAMIC_MATERIALIZE",
        });

      // Resolve the source the DV's {view} token runs against, plus its row count.
      //
      //   - Filter applied (filter view exists): run against the filter view, gated by
      //     max_records (UNLIMITED max_records === 0 skips the gate).
      //   - No filter (filter view absent): fall back to the configured BASE table,
      //     UNFILTERED, when allowed — unlimited (0), OR the base row count is below
      //     max_records. Otherwise the unfiltered base would exceed the cap → no_filter
      //     (operator must apply a filter to narrow it). This base-fallback path fires
      //     on-demand: the orchestrator's no_filter fast-path means it is reached only
      //     via an explicit retry (the "Load full table" CTA), never auto on mount.
      const baseRef = table.schema ? `${table.schema}.${table.name}` : table.name;
      let targetRef: string;
      let responseRowCount: number;

      let filterCountResult: Record<string, unknown> | null = null;
      let filterViewExists = true;
      try {
        // CONTEXT.md § D2 + DV-V16-04: COUNT(*) doubles as existence check + threshold input.
        filterCountResult = (await kineticaSqlHelper(
          authedReq,
          `SELECT COUNT(*) FROM ${expectedFilterViewName}`,
          { route: "POST /api/dynamic-view/materialize", op: "DYNAMIC_MATERIALIZE" },
        )) as Record<string, unknown> | null;
      } catch (err) {
        if (!isTableNotFoundError(err)) throw err;
        filterViewExists = false; // filter view never materialised OR TTL'd out → no filter
      }

      if (filterViewExists) {
        const rowCount = decodeCount(filterCountResult);
        // max_records === 0 → UNLIMITED: skip the threshold entirely.
        if (row.max_records > 0 && rowCount >= row.max_records) {
          await dropStale();
          return res.json({ status: "over_threshold", reason: "exceeds_max_records", row_count: rowCount });
        }
        targetRef = expectedFilterViewName;
        responseRowCount = rowCount;
      } else {
        // No filter → base-table fallback. Count the base table (cheap) to both gate
        // the fallback and report row_count.
        let baseCount: number;
        try {
          baseCount = decodeCount(
            (await kineticaSqlHelper(authedReq, `SELECT COUNT(*) FROM ${baseRef}`, {
              route: "POST /api/dynamic-view/materialize",
              op: "DYNAMIC_MATERIALIZE",
            })) as Record<string, unknown> | null,
          );
        } catch (baseErr) {
          if (isTableNotFoundError(baseErr)) {
            await dropStale();
            return res.json({ status: "over_threshold", reason: "no_filter" });
          }
          throw baseErr;
        }
        // Unlimited (0) → always use base. Otherwise only when base is under the cap.
        if (row.max_records > 0 && baseCount >= row.max_records) {
          await dropStale();
          return res.json({ status: "over_threshold", reason: "no_filter" });
        }
        targetRef = baseRef;
        responseRowCount = baseCount;
      }

      // Substitute {view} → targetRef, then CREATE OR REPLACE via the shared helper
      // (TM/SMc:1078 race-recovery is owned by the helper — Plan 01 § D5).
      let substituted: string;
      try {
        substituted = substituteViewToken(row.template_sql, targetRef);
      } catch (err) {
        if (err instanceof MissingViewTokenError) {
          // Defensive: Plan 02 validates {view} at create + update time, but DB
          // rows may be edited out-of-band. Surface as 400 rather than 500.
          return res.status(400).json({ error: err.message });
        }
        throw err;
      }

      await createOrReplaceMaterialized({
        req: authedReq,
        view: dynamicViewName,
        sqlBody: substituted,
        ttl: 5,
        route: "POST /api/dynamic-view/materialize",
        op: "DYNAMIC_MATERIALIZE",
      });

      const expiresAt = Date.now() + 5 * 60 * 1000;
      return res.json({
        status: "materialized",
        view_name: dynamicViewName,
        row_count: responseRowCount,
        expires_at: expiresAt,
      });
    })
  );

  // ----- v1.6 Phase 33 (DV-V16-07): Dynamic Views DROP-only primitive -----
  // POST /api/dynamic-view/:id/drop — DROP-only lifecycle-cleanup primitive used by
  // the frontend dynamicViewStore.reset() DROP loop (logout + dashboard switch).
  //
  // CONTRAST with DELETE /api/dynamic-view/:id below: DELETE drops the Kinetica view
  // AND deletes the SQLite row (destructive — operator's "delete this saved config" path).
  // This endpoint drops the Kinetica view ONLY — the SQLite row stays intact so the
  // operator's saved config survives logout. Mirrors the existing filter-view DROP
  // primitive (DELETE /api/filter/materialize at index.ts:801-823) which has no
  // config-row equivalent — filter views live only as Kinetica views.
  //
  // Idempotent — DROP IF EXISTS is silent on missing views. The frontend reset() loop
  // is fire-and-forget (.catch(()=>{})) so a 4xx/5xx here never blocks logout.
  app.post(
    "/api/dynamic-view/:id/drop",
    requireConfig,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "id path param must be numeric." });
      }
      const row = getDashboardDynamicView(id);
      if (!row) {
        return res.status(404).json({ error: "Dynamic view not found." });
      }
      const authedReq = req as AuthedRequest;
      const dynamicViewName = buildDynamicViewName({
        userId: authedReq.user!.creds.username,
        dashboardId: row.dashboard_id,
        dynamicViewId: row.id,
      });
      // DROP-only — NO call to deleteDashboardDynamicView. SQLite row stays intact.
      // Errors bubble through errorMiddleware (auth/permission/upstream — frontend swallows them).
      await kineticaSqlHelper(authedReq, `DROP TABLE IF EXISTS ${dynamicViewName}`, {
        route: "POST /api/dynamic-view/:id/drop",
        op: "DYNAMIC_DROP",
      });
      return res.json({ dropped: true });
    })
  );

  // DELETE /api/dynamic-view/:id — drop materialized view + delete row.
  app.delete(
    "/api/dynamic-view/:id",
    requireConfig,
    ...requirePermission(PERMISSIONS.DYNAMIC_VIEWS_MANAGE),
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "id path param must be numeric." });
      }
      const row = getDashboardDynamicView(id);
      if (!row) {
        return res.status(404).json({ error: "Dynamic view not found." });
      }
      const authedReq = req as AuthedRequest;
      const dynamicViewName = buildDynamicViewName({
        userId: authedReq.user!.creds.username,
        dashboardId: row.dashboard_id,
        dynamicViewId: row.id,
      });
      // DROP first (best-effort — DROP IF EXISTS is idempotent on missing views);
      // then delete the SQLite row. If the DROP fails for non-existence reasons
      // (auth, permission, upstream), errorMiddleware translates it and the
      // SQLite row is NOT deleted — caller can retry safely.
      await kineticaSqlHelper(authedReq, `DROP TABLE IF EXISTS ${dynamicViewName}`, {
        route: "DELETE /api/dynamic-view/:id",
        op: "DYNAMIC_MATERIALIZE",
      });
      const deleted = deleteDashboardDynamicView(id);
      return res.json({ deleted, dropped: true });
    })
  );
  // ===== End Phase 32 Plan 03 — Dynamic Views runtime endpoints =====

  // ----- v1.4 Phase 18: Map info popup spatial query (SPATIAL-V14-04) -----
  // POST /api/info/query — resolve a map click to nearby records via Kinetica
  // spatial-distance. Backed by Plan 18-02's pure SQL builders (spatialQuery.ts)
  // + radius-conversion helpers (radiusConversion.ts).
  //
  // Request body shape (locked in REQUIREMENTS.md SPATIAL-V14-04):
  //   { layerId, tableId, schema, table, spatialMode, spatialColumns,
  //     clickLon, clickLat, radiusPx, mapBbox, mapWidthPx, mapHeightPx, page }
  //
  // Response shape:
  //   { rows: Record<string, unknown>[], columns: string[],
  //     totalEstimate?: number, hasMore: boolean, page: number }
  //
  // Phase 18 locks (planning_context):
  //   - View-of-views (v1.4 follow-up): when the request includes a non-empty
  //     `viewName`, the SQL builder emits `FROM <viewName>` so the info popup
  //     reflects the same record set the WMS layer is showing. Caller looks up
  //     useFilterViewStore.views[tableId] with isViewExpired guard. When absent,
  //     falls through to `FROM <schema>.<table>` (Phase 18 default).
  //   - No try/catch: typed Kinetica errors bubble through asyncHandler →
  //     errorMiddleware (mirrors POST /api/filter/materialize, distinct from
  //     POST /api/views/:id/materialize which persists a status row).
  //   - Per-user creds via kineticaSql(req, sql, { op: "INFO_QUERY" }) —
  //     credential-type-aware auth header in auth.ts buildAuthHeader.
  //   - radiusPx → ground distance is computed SERVER-SIDE: pxToGroundDistance
  //     (meters; GEODIST consumer) for spatialMode='latlon'; pxToGroundDegrees
  //     (degrees; STXY_DISTANCE consumer) for spatialMode='wkt'. Avoids client
  //     trigonometry duplication and keeps the threshold consistent across
  //     zoom levels.
  //   - WKB SQL template DEFERRED to TD-V14-WKB-SPIKE — Plan 18-01 spike
  //     landed NONE_ESCALATE (operator has no WKB-binary column reachable;
  //     runner-bug-tainted first run + WKT-typed fixture column prevented
  //     characterization). Endpoint returns 501 for spatialMode='wkb' with
  //     body { error: 'WKB mode deferred', td: 'TD-V14-WKB-SPIKE' }. The
  //     buildWkbQuery function in spatialQuery.ts throws WkbDeferredError by
  //     design — the endpoint early-returns 501 BEFORE invoking it (and
  //     intentionally does NOT import it). See 18-SPIKE-NOTES.md ## Decision.
  app.post("/api/info/query", requireConfig, asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Partial<{
      layerId: number;
      tableId: number;
      schema: string;
      table: string;
      viewName: string;
      spatialMode: SpatialMode;
      spatialColumns: SpatialColumns;
      clickLon: number;
      clickLat: number;
      radiusPx: number;
      mapBbox: [number, number, number, number];
      mapWidthPx: number;
      mapHeightPx: number;
      page: number;
    }>;

    // ── Validation: required scalars ────────────────────────────────────
    if (typeof body.layerId !== "number" || typeof body.tableId !== "number") {
      return res.status(400).json({ error: "layerId and tableId are required numbers." });
    }
    if (typeof body.schema !== "string" || typeof body.table !== "string" ||
        body.schema.length === 0 || body.table.length === 0) {
      return res.status(400).json({ error: "schema and table are required non-empty strings." });
    }
    if (body.viewName !== undefined &&
        (typeof body.viewName !== "string" || body.viewName.length === 0)) {
      return res.status(400).json({ error: "viewName, when provided, must be a non-empty string." });
    }
    if (body.spatialMode !== "latlon" && body.spatialMode !== "wkt" && body.spatialMode !== "wkb") {
      return res.status(400).json({ error: "spatialMode must be 'latlon', 'wkt', or 'wkb'." });
    }
    if (typeof body.spatialColumns !== "object" || body.spatialColumns === null) {
      return res.status(400).json({ error: "spatialColumns is required." });
    }
    if (typeof body.clickLon !== "number" || typeof body.clickLat !== "number") {
      return res.status(400).json({ error: "clickLon and clickLat are required numbers." });
    }
    if (typeof body.radiusPx !== "number" || body.radiusPx <= 0) {
      return res.status(400).json({ error: "radiusPx must be a positive number." });
    }
    if (!Array.isArray(body.mapBbox) || body.mapBbox.length !== 4 ||
        !body.mapBbox.every((n) => typeof n === "number")) {
      return res.status(400).json({ error: "mapBbox must be a 4-number array." });
    }
    if (typeof body.mapWidthPx !== "number" || typeof body.mapHeightPx !== "number" ||
        body.mapWidthPx <= 0 || body.mapHeightPx <= 0) {
      return res.status(400).json({ error: "mapWidthPx and mapHeightPx must be positive numbers." });
    }
    if (typeof body.page !== "number" || body.page < 0 || !Number.isInteger(body.page)) {
      return res.status(400).json({ error: "page must be a non-negative integer." });
    }

    // ── Validation: spatialColumns matches spatialMode ──────────────────
    if (body.spatialMode === "latlon" &&
        (typeof body.spatialColumns.lonCol !== "string" || typeof body.spatialColumns.latCol !== "string")) {
      return res.status(400).json({ error: "spatialColumns.lonCol and spatialColumns.latCol are required for spatialMode='latlon'." });
    }
    if (body.spatialMode === "wkt" && typeof body.spatialColumns.wktCol !== "string") {
      return res.status(400).json({ error: "spatialColumns.wktCol is required for spatialMode='wkt'." });
    }
    if (body.spatialMode === "wkb" && typeof body.spatialColumns.wkbCol !== "string") {
      return res.status(400).json({ error: "spatialColumns.wkbCol is required for spatialMode='wkb'." });
    }

    // ── Verify the table is registered in the admin metadata (404 guard) ─
    const tableRow = getTable(body.tableId);
    if (!tableRow) {
      return res.status(404).json({ error: "Table not found." });
    }

    const authedReq = req as AuthedRequest;

    // ── Build SQL: dispatch by spatialMode ──────────────────────────────
    // GEODIST returns meters → pxToGroundDistance (meters).
    // STXY_DISTANCE returns SRS-units (degrees-equivalent for EPSG:4326)
    //   → pxToGroundDegrees (degrees). Both wkt and wkb (Kinetica geometry
    //   column) use STXY_DISTANCE — same template, different column name.
    const builderArgs = {
      schema: body.schema,
      table: body.table,
      viewName: body.viewName,
      spatialColumns: body.spatialColumns,
      clickLon: body.clickLon,
      clickLat: body.clickLat,
      page: body.page,
    };

    let sql: string;
    if (body.spatialMode === "latlon") {
      const radiusMeters = pxToGroundDistance(
        body.radiusPx,
        body.mapBbox,
        body.mapWidthPx,
        body.mapHeightPx,
        body.clickLat,
      );
      sql = buildLatLonQuery({ ...builderArgs, radiusGroundDistance: radiusMeters });
    } else {
      // wkt or wkb — wkt uses STXY_DISTANCE (text columns), wkb uses ST_DISTANCE
      // (GEOMETRY columns). See spatialQuery.ts § buildWktQuery / buildWkbQuery
      // for the type-vs-function contract.
      const radiusDegrees = pxToGroundDegrees(
        body.radiusPx,
        body.mapBbox,
        body.mapWidthPx,
      );
      sql = body.spatialMode === "wkt"
        ? buildWktQuery({ ...builderArgs, radiusGroundDistance: radiusDegrees })
        : buildWkbQuery({ ...builderArgs, radiusGroundDistance: radiusDegrees });
    }

    // Post-VERIFY auto-fallback for the WKT-vs-GEOMETRY column-type mismatch:
    // operators sometimes pick "WKT geometry column" mode for a column that is
    // actually a Kinetica native GEOMETRY type (e.g. dynamic views that project
    // H3_CELLTOBOUNDARY output into a column named "WKT"). STXY_DISTANCE rejects
    // those with "function: 'stxy_distance' has invalid argument list: geometry,
    // decimal8,decimal8,int (U/TRCc:2056)". Catch that exact error and retry
    // with the GEOMETRY-aware ST_DISTANCE builder so the operator doesn't have
    // to know the column's actual storage type.
    const isStxyOnGeometryError = (err: unknown): boolean => {
      const msg = (err as Error)?.message ?? "";
      return (
        /stxy_distance.*invalid argument list/i.test(msg) &&
        /\bgeometry\b/i.test(msg)
      );
    };

    let result: Record<string, unknown> | null;
    try {
      // The SQL itself has LIMIT 50 OFFSET <page*50>; the kineticaSql `extra.limit`
      // is the Kinetica request envelope's limit (distinct from the SQL LIMIT clause).
      // Set it to 50 for clarity — keeps the response envelope from over-allocating.
      result = (await kineticaSqlHelper(authedReq, sql, {
        route: "POST /api/info/query",
        op: "INFO_QUERY",
        extra: { limit: 50 },
      })) as Record<string, unknown> | null;
    } catch (err) {
      // Auto-fallback ONLY for the wkt-mode-on-geometry case.
      if (body.spatialMode === "wkt" && isStxyOnGeometryError(err)) {
        const radiusDegrees = pxToGroundDegrees(
          body.radiusPx,
          body.mapBbox,
          body.mapWidthPx,
        );
        // buildWkbQuery reads spatialColumns.wkbCol — map the operator's wktCol
        // value over so the GEOMETRY column name is passed through verbatim.
        const wkbBuilderArgs = {
          ...builderArgs,
          spatialColumns: {
            ...builderArgs.spatialColumns,
            wkbCol: builderArgs.spatialColumns.wktCol,
          },
          radiusGroundDistance: radiusDegrees,
        };
        const fallbackSql = buildWkbQuery(wkbBuilderArgs);
        result = (await kineticaSqlHelper(authedReq, fallbackSql, {
          route: "POST /api/info/query",
          op: "INFO_QUERY",
          extra: { limit: 50 },
        })) as Record<string, unknown> | null;
      } else {
        throw err;
      }
    }

    // Parse Kinetica's encoded response (column-major):
    //   { column_headers: string[], column_1: T1[], column_2: T2[], ... }
    // into row-major:
    //   [{ col1: v1, col2: v2, ... }, ...]
    // Mirrors the convention used elsewhere (e.g. discovery routes' column_1
    // string[] consumption at index.ts:771-782); here we generalize across N columns.
    const columns: string[] = Array.isArray((result as { column_headers?: unknown })?.column_headers)
      ? ((result as { column_headers: string[] }).column_headers)
      : [];
    const firstCol = columns.length > 0
      ? ((result as Record<string, unknown>)[`column_1`] as unknown[] | undefined)
      : undefined;
    const rowCount = Array.isArray(firstCol) ? firstCol.length : 0;
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < rowCount; i++) {
      const row: Record<string, unknown> = {};
      for (let c = 0; c < columns.length; c++) {
        const colArr = (result as Record<string, unknown>)[`column_${c + 1}`] as unknown[] | undefined;
        row[columns[c]] = colArr ? colArr[i] : null;
      }
      rows.push(row);
    }

    return res.json({
      rows,
      columns,
      hasMore: rows.length === 50,
      page: body.page,
    });
  }));

  // Table persistence
  app.get("/api/tables", (_req, res) => {
    res.json({ data: listTables() });
  });

  app.get("/api/tables/:id", (req, res) => {
    const id = Number(req.params.id);
    const table = getTable(id);
    if (!table) return res.status(404).json({ error: "Table not found." });
    return res.json(table);
  });

  app.post("/api/tables", ...requirePermission(PERMISSIONS.DATASETS_MANAGE), (req, res) => {
    const { name, schema, description, columns } = req.body as Partial<Table>;
    if (!name) return res.status(400).json({ error: "Table name is required." });
    if (schema === undefined) return res.status(400).json({ error: "Table schema is required." });
    const table = createTable({ name, schema, description, columns });
    return res.status(201).json(table);
  });

  app.patch("/api/tables/:id", ...requirePermission(PERMISSIONS.DATASETS_MANAGE), (req, res) => {
    const id = Number(req.params.id);
    const updated = updateTable(id, req.body);
    if (!updated) return res.status(404).json({ error: "Table not found." });
    return res.json(updated);
  });

  app.delete("/api/tables/:id", ...requirePermission(PERMISSIONS.DATASETS_MANAGE), (req, res) => {
    const id = Number(req.params.id);
    const ok = deleteTable(id);
    if (!ok) return res.status(404).json({ error: "Table not found." });
    return res.status(204).send();
  });

  // Kinetica discovery routes — all routed through kineticaSqlHelper with per-user creds
  // PHASE 3: try/catch removed; typed errors bubble to errorMiddleware via asyncHandler.
  app.get("/api/kinetica/schemas", requireConfig, asyncHandler(async (req, res) => {
    const result = (await kineticaSqlHelper(
      req as AuthedRequest,
      "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME NOT IN ('SYSTEM', 'information_schema', 'ki_catalog', 'pg_catalog') ORDER BY SCHEMA_NAME ASC",
      { route: "GET /api/kinetica/schemas", op: "DISCOVERY" }
    )) as { column_1?: string[] };
    const schemas: string[] = result?.column_1 || [];
    return res.json({ data: schemas });
  }));

  app.get("/api/kinetica/schemas/:schema/tables", requireConfig, asyncHandler(async (req, res) => {
    const schema = req.params.schema;
    const result = (await kineticaSqlHelper(
      req as AuthedRequest,
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${schema.replace(/'/g, "''")}' ORDER BY TABLE_NAME ASC`,
      { route: "GET /api/kinetica/schemas/:schema/tables", op: "DISCOVERY" }
    )) as { column_1?: string[] };
    const tables: string[] = result?.column_1 || [];
    return res.json({ data: tables });
  }));

  app.get("/api/kinetica/schemas/:schema/tables/:table/columns", requireConfig, asyncHandler(async (req, res) => {
    const schema = req.params.schema;
    const table = req.params.table;
    const result = (await kineticaSqlHelper(
      req as AuthedRequest,
      `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = '${schema.replace(/'/g, "''")}' AND TABLE_NAME = '${table.replace(/'/g, "''")}' ORDER BY ORDINAL_POSITION ASC`,
      { route: "GET /api/kinetica/schemas/:schema/tables/:table/columns", op: "DISCOVERY" }
    )) as { column_1?: string[]; column_2?: string[] };
    const names: string[] = result?.column_1 || [];
    const types: string[] = result?.column_2 || [];
    const columns: Record<string, string> = {};
    names.forEach((name, i) => { columns[name] = types[i] || "unknown"; });

    // INFORMATION_SCHEMA.COLUMNS.DATA_TYPE reports only the base storage type, so
    // Kinetica TIMESTAMP/DATE/TIME/DATETIME columns arrive as "bigint"/"long" and
    // never qualify as datetime in the UI (e.g. Timeline's Time-column picker).
    // Recover the temporal sub-type from the native /show/table `properties` and
    // OVERRIDE those columns only. Best-effort: any failure falls back to the pure
    // INFORMATION_SCHEMA result above (zero regression).
    try {
      const showTable = await kineticaShowTable(
        req as AuthedRequest,
        `${schema}.${table}`,
        { route: "GET /api/kinetica/schemas/:schema/tables/:table/columns", op: "DISCOVERY" }
      );
      const temporal = parseTemporalColumns(showTable, `${schema}.${table}`);
      for (const [col, t] of Object.entries(temporal)) {
        if (col in columns) columns[col] = t;
      }
    } catch (err) {
      console.error("[columns] /show/table temporal enrichment failed; using INFORMATION_SCHEMA types", err);
    }

    return res.json({ data: columns });
  }));

  // WMS proxy to Kinetica
  // PHASE 3: try/catch removed; typed errors bubble to errorMiddleware via asyncHandler.
  app.get("/api/wms", requireConfig, asyncHandler(async (req, res) => {
    // PITFALL M-08 lock: browser cache is not auth-aware; never serve stale tiles after filter change OR after OIDC token rotation
    res.setHeader("Cache-Control", "no-store");
    const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
    const response = await kineticaWms(req as AuthedRequest, queryString, {
      route: "GET /api/wms",
    });
    const contentType = response.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    const buffer = Buffer.from(await response.arrayBuffer());
    return res.send(buffer);
  }));

  // WMS capabilities probe — returns cached JSON shape with supported renderModes, colormaps,
  // spatialModes, and srs. Browser-cacheable for 5 min (capabilities rarely change at runtime).
  // M-08-adjacent lock: short private cache (NOT no-store) since this is not tile data and does
  // not encode per-user state. An app reload picks up any server-side capability changes.
  app.get("/api/wms/capabilities", requireConfig, asyncHandler(async (_req, res) => {
    res.setHeader("Cache-Control", "private, max-age=300");
    try {
      const capabilities = await getCachedCapabilities();
      res.json(capabilities);
    } catch (err) {
      console.error("WMS capabilities probe failed", err);
      // Graceful degradation: return fallback shape with all modes assumed supported.
      res.json({
        renderModes: ["raster", "heatmap", "classbreak", "contour"],
        colormaps: ["viridis", "plasma", "inferno", "magma", "cividis", "turbo", "jet", "hot"],
        spatialModes: ["latlon", "wkt", "wkb"],
        srs: ["EPSG:3857"],
        source: "fallback",
      });
    }
  }));

  // SQL proxy to Kinetica
  // PHASE 3: try/catch removed; typed errors bubble to errorMiddleware via asyncHandler.
  app.post("/api/sql", requireConfig, asyncHandler(async (req, res) => {
    const { sql, options } = req.body as { sql?: string; options?: Record<string, unknown> };
    if (!sql || typeof sql !== "string") {
      return res.status(400).json({ error: "Body must include a 'sql' string." });
    }
    const data = await kineticaSqlHelper(req as AuthedRequest, sql, {
      route: "POST /api/sql",
      op: "SQL",
      extra: options,
    });
    return res.json(data);
  }));

  // ─── v1.8 Phase 47 Plan 03: RBAC Management Routes (GUARD-V18-04) ────────────
  // 7 management routes for user/role administration. All gated with requirePermission.
  // No requireConfig needed — these routes are SQLite-only; no Kinetica calls.
  // REST shapes intentionally detailed to lock the Phase 49 contract now.
  //
  // SAFE-V18-01 (last-admin protection) is implemented in Phase 49 in the DELETE role handler.
  // SAFE-V18-02 (escalation guards) are implemented in Phase 50 (POST /api/users/:username/roles
  // Guard 1 and PUT /api/roles/:id/permissions Guards 2 + 3).
  //
  // Pitfall-6-safe targeting: target = req.params.username.toLowerCase() (the user being
  // administered); actor = req.user!.creds.username (the admin caller for Phase 50 audit).

  // GET /api/users — list all known+assigned users with their roles, last_seen, and is_bootstrap flag
  // USERS-V18-01: extends Phase 47 union query to include last_seen from known_users and
  // is_bootstrap flag. Synthesizes a bootstrap row when the bootstrap username is absent from
  // both tables (e.g. fresh deployment with no logins yet).
  app.get("/api/users", ...requirePermission(PERMISSIONS.USERS_VIEW), (req, res) => {
    // LEFT JOIN known_users ku2 to pick up last_seen without disturbing the UNION de-dup.
    // The UNION subquery (ku) is the source of distinct usernames; ku2 provides last_seen only.
    const rows = db.prepare(`
      SELECT ku.username,
             ku2.last_seen AS last_seen,
             json_group_array(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL) AS roles
      FROM (
        SELECT username FROM known_users
        UNION
        SELECT DISTINCT username FROM user_roles
      ) AS ku
      LEFT JOIN known_users ku2 ON ku2.username = ku.username
      LEFT JOIN user_roles ur ON ur.username = ku.username
      LEFT JOIN roles r ON r.id = ur.role_id
      GROUP BY ku.username
      ORDER BY ku.username
    `).all() as Array<{ username: string; last_seen: string | null; roles: string }>;
    const bootstrapUsername = (process.env.APP_ADMIN_USERNAME || "admin").toLowerCase();
    const users = rows.map((row) => ({
      username: row.username,
      roles: JSON.parse(row.roles) as string[],
      last_seen: row.last_seen ?? null,
      is_bootstrap: row.username === bootstrapUsername,
    }));
    // Synthesize the bootstrap row if absent from both tables (never-logged-in, no roles).
    if (!users.some((u) => u.username === bootstrapUsername)) {
      users.unshift({ username: bootstrapUsername, roles: [], last_seen: null, is_bootstrap: true });
    }
    return res.json({ users });
  });

  // POST /api/users/:username/roles — assign a role to a user
  app.post("/api/users/:username/roles", ...requirePermission(PERMISSIONS.USERS_ASSIGN_ROLES), (req, res) => {
    const target = req.params.username.toLowerCase(); // Pitfall 6: target from path, not session
    const { roleName } = req.body as { roleName?: string };
    if (!roleName) return res.status(400).json({ error: "roleName is required." });
    const roleRow = db.prepare("SELECT id FROM roles WHERE name = ?").get(roleName) as { id: number } | undefined;
    if (!roleRow) return res.status(404).json({ error: `Role '${roleName}' not found.` });
    // SAFE-V18-02 Guard 1: only admins can assign the admin role.
    const actor = (req as AuthedRequest).user!.creds.username;
    const callerIsAdmin = getEffectiveRoles(actor).includes("admin");
    if (!callerIsAdmin && roleName === "admin") {
      return res.status(403).json({ error: "Only admins can assign the admin role." });
    }
    // Capture the target's ASSIGNED role names (raw rows, not analyst-fallback) before INSERT.
    const beforeRoles = (db.prepare(
      "SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.username = lower(?)"
    ).all(target) as Array<{ name: string }>).map((r) => r.name);
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (lower(?), ?)").run(target, roleRow.id);
    // Capture after state.
    const afterRoles = (db.prepare(
      "SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.username = lower(?)"
    ).all(target) as Array<{ name: string }>).map((r) => r.name);
    emitRbacAudit(db, {
      actor,
      action: "role_assigned",
      target,
      before_json: JSON.stringify(beforeRoles),
      after_json: JSON.stringify(afterRoles),
    });
    return res.json({ ok: true, username: target, roleName });
  });

  // DELETE /api/users/:username/roles/:roleName — revoke a role from a user (idempotent)
  // SAFE-V18-01: last-admin protection guard implemented in Phase 49.
  app.delete("/api/users/:username/roles/:roleName", ...requirePermission(PERMISSIONS.USERS_ASSIGN_ROLES), (req, res) => {
    const target = req.params.username.toLowerCase(); // Pitfall 6
    const roleName = req.params.roleName;
    const roleRow = db.prepare("SELECT id FROM roles WHERE name = ?").get(roleName) as { id: number } | undefined;
    if (!roleRow) return res.status(404).json({ error: `Role '${roleName}' not found.` });

    // SAFE-V18-01: last-admin protection. Only engages for the admin role when the
    // target currently holds it. Bootstrap admin is exempt and never counted.
    if (roleName === "admin") {
      const bootstrapUsername = (process.env.APP_ADMIN_USERNAME || "admin").toLowerCase();
      const holdsAdmin = db.prepare(
        "SELECT 1 FROM user_roles WHERE username = lower(?) AND role_id = ?"
      ).get(target, roleRow.id);
      if (holdsAdmin) {
        const remaining = (db.prepare(
          "SELECT COUNT(*) AS cnt FROM user_roles WHERE role_id = ? AND username != lower(?)"
        ).get(roleRow.id, bootstrapUsername) as { cnt: number }).cnt;
        // remaining counts non-bootstrap admin holders INCLUDING the target. If <= 1,
        // the target is the last one; deleting it would leave zero non-bootstrap admins.
        if (remaining <= 1) {
          return res.status(400).json({
            error: "Cannot revoke: this is the last admin. At least one non-bootstrap user must hold the admin role.",
          });
        }
      }
    }

    // Capture the target's ASSIGNED role names before DELETE.
    const actor = (req as AuthedRequest).user!.creds.username;
    const beforeRoles = (db.prepare(
      "SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.username = lower(?)"
    ).all(target) as Array<{ name: string }>).map((r) => r.name);
    db.prepare("DELETE FROM user_roles WHERE username = lower(?) AND role_id = ?").run(target, roleRow.id);
    // Capture after state.
    const afterRoles = (db.prepare(
      "SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.username = lower(?)"
    ).all(target) as Array<{ name: string }>).map((r) => r.name);
    emitRbacAudit(db, {
      actor,
      action: "role_revoked",
      target,
      before_json: JSON.stringify(beforeRoles),
      after_json: JSON.stringify(afterRoles),
    });
    return res.json({ ok: true, username: target, roleName });
  });

  // GET /api/roles — list all roles with their permissions
  app.get("/api/roles", ...requirePermission(PERMISSIONS.ROLES_VIEW), (_req, res) => {
    const roleRows = db.prepare("SELECT id, name, description, built_in FROM roles ORDER BY name").all() as Array<{
      id: number; name: string; description: string; built_in: number;
    }>;
    const roles = roleRows.map((role) => {
      const perms = db.prepare(
        "SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission"
      ).all(role.id) as Array<{ permission: string }>;
      const { cnt } = db.prepare(
        "SELECT COUNT(*) AS cnt FROM user_roles WHERE role_id = ?"
      ).get(role.id) as { cnt: number };
      return {
        id: role.id,
        name: role.name,
        description: role.description,
        built_in: Boolean(role.built_in),
        permissions: perms.map((p) => p.permission),
        holders_count: cnt,
      };
    });
    return res.json({ roles });
  });

  // POST /api/roles — create a custom role
  app.post("/api/roles", ...requirePermission(PERMISSIONS.ROLES_CREATE_CUSTOM), (req, res) => {
    const { name, description, permissions: perms } = req.body as {
      name?: string; description?: string; permissions?: string[];
    };
    if (!name) return res.status(400).json({ error: "name is required." });
    if (!Array.isArray(perms)) return res.status(400).json({ error: "permissions array is required." });
    // ROLES-V18-03: slug validation — lowercase letters, digits, underscores only.
    if (!/^[a-z0-9_]+$/.test(name)) {
      return res.status(400).json({ error: "Role name must be a lowercase slug (letters, digits, underscore)." });
    }
    // ROLES-V18-03: reserved built-in name check.
    if (BUILTIN_ROLES.includes(name as (typeof BUILTIN_ROLES)[number])) {
      return res.status(400).json({ error: `'${name}' is a reserved built-in role name.` });
    }
    // 409 if name already exists (case-insensitive)
    const existing = db.prepare("SELECT id FROM roles WHERE lower(name) = lower(?)").get(name);
    if (existing) return res.status(409).json({ error: `Role '${name}' already exists.` });
    const result = db.prepare(
      "INSERT INTO roles (name, description, built_in) VALUES (?, ?, 0)"
    ).run(name, description ?? "");
    const roleId = result.lastInsertRowid as number;
    // Insert permissions
    const insertPerm = db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)");
    for (const perm of perms) {
      insertPerm.run(roleId, perm);
    }
    const newRole = {
      id: roleId,
      name,
      description: description ?? "",
      built_in: false,
      permissions: perms,
    };
    emitRbacAudit(db, {
      actor: (req as AuthedRequest).user!.creds.username,
      action: "role_created",
      target: name,
      before_json: null,
      after_json: JSON.stringify(perms),
    });
    return res.status(201).json({ role: newRole });
  });

  // PUT /api/roles/:id/permissions — replace a role's permission set
  app.put("/api/roles/:id/permissions", ...requirePermission(PERMISSIONS.ROLES_MANAGE_PERMISSIONS), (req, res) => {
    const roleId = Number(req.params.id);
    if (!Number.isFinite(roleId)) return res.status(400).json({ error: "id must be numeric." });
    const roleRow = db.prepare("SELECT id, name FROM roles WHERE id = ?").get(roleId) as { id: number; name: string } | undefined;
    if (!roleRow) return res.status(404).json({ error: "Role not found." });
    const { permissions: newPerms } = req.body as { permissions?: string[] };
    if (!Array.isArray(newPerms)) return res.status(400).json({ error: "permissions array is required." });
    // Validate each permission string against the catalog
    const validPerms = new Set(Object.values(PERMISSIONS));
    const invalid = newPerms.filter((p) => !validPerms.has(p as typeof PERMISSIONS[keyof typeof PERMISSIONS]));
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Unknown permissions: ${invalid.join(", ")}` });
    }
    // SAFE-V18-02 Guard 2: only admins can modify the admin role's permission set.
    const actor = (req as AuthedRequest).user!.creds.username;
    const callerIsAdmin = getEffectiveRoles(actor).includes("admin");
    if (!callerIsAdmin && roleRow.name === "admin") {
      return res.status(403).json({ error: "Only admins can modify the admin role." });
    }
    // SAFE-V18-02 Guard 3: caller cannot grant permissions they do not hold.
    if (!callerIsAdmin) {
      const callerPerms = getEffectivePermissions(actor);
      const unheld = newPerms.filter((p) => !callerPerms.has(p as Permission));
      if (unheld.length > 0) {
        return res.status(403).json({ error: `Cannot grant permissions you do not hold: ${unheld.join(", ")}` });
      }
    }
    // Capture before_json BEFORE the DELETE (plan requirement: before captured before mutation).
    const beforePerms = (db.prepare(
      "SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission"
    ).all(roleId) as Array<{ permission: string }>).map((r) => r.permission);
    // Replace: DELETE existing then INSERT new set
    db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(roleId);
    const insertPerm = db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)");
    for (const perm of newPerms) {
      insertPerm.run(roleId, perm);
    }
    emitRbacAudit(db, {
      actor,
      action: "mappings_updated",
      target: roleRow.name,
      before_json: JSON.stringify(beforePerms),
      after_json: JSON.stringify(newPerms),
    });
    return res.json({ ok: true, roleId, permissions: newPerms });
  });

  // DELETE /api/roles/:id — delete a custom role
  app.delete("/api/roles/:id", ...requirePermission(PERMISSIONS.ROLES_DELETE_CUSTOM), (req, res) => {
    const roleId = Number(req.params.id);
    if (!Number.isFinite(roleId)) return res.status(400).json({ error: "id must be numeric." });
    const roleRow = db.prepare("SELECT id, name, built_in FROM roles WHERE id = ?").get(roleId) as { id: number; name: string; built_in: number } | undefined;
    if (!roleRow) return res.status(404).json({ error: "Role not found." });
    // Block deletion of built-in roles (400) — fires BEFORE the holder check.
    if (roleRow.built_in) return res.status(400).json({ error: "Cannot delete a built-in role." });
    // ROLES-V18-04: block deletion of a role that still has active holders (409).
    const holders = (db.prepare("SELECT COUNT(*) AS cnt FROM user_roles WHERE role_id = ?").get(roleId) as { cnt: number }).cnt;
    if (holders > 0) {
      return res.status(409).json({ error: `Cannot delete: ${holders} user(s) currently hold this role.` });
    }
    // Capture before_json (role's permissions) BEFORE the DELETE.
    const beforePerms = (db.prepare(
      "SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission"
    ).all(roleId) as Array<{ permission: string }>).map((r) => r.permission);
    const roleName = roleRow.name;
    const actor = (req as AuthedRequest).user!.creds.username;
    db.prepare("DELETE FROM roles WHERE id = ?").run(roleId);
    emitRbacAudit(db, {
      actor,
      action: "role_deleted",
      target: roleName,
      before_json: JSON.stringify(beforePerms),
      after_json: null,
    });
    return res.json({ ok: true, roleId });
  });

  // Global error-handling middleware — translates typed Kinetica errors to user-visible responses.
  // Must be mounted before the 404 handler (CONTEXT.md §"Backend global error middleware" → "Mount location").
  // 4-arg signature is Express's contract for error middleware.
  app.use(errorMiddleware);

  app.use((req, res) => {
    res.status(404).json({ error: "Not found", path: req.path });
  });

  return app;
};

/**
 * Global Express error-handling middleware.
 *
 * Translates Phase 2's typed Kinetica errors into the user-visible HTTP responses
 * Phase 3 promises (UX-01/02/03). Exported so tests can mount it standalone.
 *
 * Translation rules (CONTEXT.md §"Backend global error middleware"):
 *   - KineticaAuthError       → 401 + { error, code: "REAUTH_REQUIRED" } + clearSessionCookie
 *   - KineticaPermissionError → 403 + { error }  (NO code field)
 *   - KineticaUpstreamError   → 502 + { error }  (NO code field)
 *   - Anything else           → 500 + generic error message + console.error
 *
 * NOTE: The middleware does NOT call deleteSession — orphaned rows are GC'd by the
 * Phase 1 sweep within 1 hour. (CONTEXT.md §"401-REAUTH cookie clearing" para 3.)
 */
export const errorMiddleware = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof KineticaAuthError) {
    clearSessionCookie(res);
    res.status(401).json({ error: err.message, code: "REAUTH_REQUIRED" });
    return;
  }
  if (err instanceof KineticaPermissionError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof KineticaUpstreamError) {
    res.status(502).json({ error: err.message });
    return;
  }
  // Defensive: non-typed error — should not happen once routes are stripped (Plan 03-02).
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};

if (process.env.NODE_ENV !== "test") {
  // Async IIFE — the bootstrap regex test (tests/bootstrap.spec.ts) verifies that this
  // gate body contains BOTH app.listen AND startSessionSweep(). Both live inside the IIFE
  // body which is itself inside the gate's brace block, so the regex matches.
  void (async () => {
    try {
      const port = process.env.PORT || 4000;
      const app = await createApp();
      app.listen(port, () => {
        console.log(`Kinetica BI backend running on http://localhost:${port}`);
      });
      // Kick off the GC sweep AFTER listen so any startup error in sessionStore
      // surfaces before we accept traffic. .unref() inside startSessionSweep keeps
      // test processes able to exit cleanly.
      startSessionSweep();
    } catch (err) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          event: "boot_failed",
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        })
      );
      process.exit(1);
    }
  })();
}
