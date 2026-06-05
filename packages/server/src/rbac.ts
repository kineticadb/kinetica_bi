/**
 * rbac.ts — requirePermission middleware factory (v1.8 GUARD-V18-01).
 *
 * Returns an array of RequestHandlers to spread into a route definition:
 *
 *   app.post("/api/dashboards", ...requirePermission(PERMISSIONS.DASHBOARDS_CREATE), handler)
 *
 * The array contains two elements:
 *   [0] requireAuth — populates req.user (idempotent; safe to call twice when global
 *       app.use("/api", requireAuth) is also mounted — it just calls next() again).
 *   [1] rbacCheck   — reads effective permissions from SQLite and either calls next()
 *       or returns 403 with { error, code: "PERMISSION_DENIED", permission }.
 *
 * Denial log shape mirrors OBS-01 (boot-log style):
 *   { ts, level: "warn", event: "permission_denied", username, route, method, permission, outcome: "denied" }
 *
 * Key design choices:
 *   - Returns RequestHandler[] (NOT a single RequestHandler) to force callers to spread it.
 *     Plan 03 uses `...requirePermission(perm)` in every call site — TypeScript enforces this.
 *   - getEffectivePermissions called with NO conn arg (uses module-singleton db).
 *   - requireAuth is element 0 so req.user is always populated when rbacCheck runs.
 *   - No new npm dependencies — pure TypeScript using existing better-sqlite3 sync read.
 *
 * Pure module — no side effects at import time. Mirrors lib/rbacDb.ts style.
 */

import type { NextFunction, Response, RequestHandler } from "express";
import { requireAuth, type AuthedRequest } from "./auth";
import { getEffectivePermissions } from "./lib/rbacDb";
import type { Permission } from "./lib/permissions";

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Returns a two-element RequestHandler array:
 *   [requireAuth, rbacCheck]
 *
 * Callers MUST spread this into the route:
 *   app.post("/route", ...requirePermission(PERMISSIONS.DASHBOARDS_CREATE), handler)
 *
 * The permission parameter is constrained to the canonical Permission type from
 * lib/permissions.ts — TypeScript catches invalid string literals at compile time.
 */
export const requirePermission = (permission: Permission): RequestHandler[] => [
  requireAuth,
  (req: AuthedRequest, res: Response, next: NextFunction) => {
    const username = req.user!.creds.username;
    const perms = getEffectivePermissions(username);

    if (!perms.has(permission)) {
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          event: "permission_denied",
          username,
          route: req.path,
          method: req.method,
          permission,
          outcome: "denied",
        })
      );
      return res.status(403).json({
        error: `Permission denied: ${permission} is required`,
        code: "PERMISSION_DENIED",
        permission,
      });
    }

    return next();
  },
];
