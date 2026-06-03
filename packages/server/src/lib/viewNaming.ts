/**
 * View-name composition for transient Kinetica materialized views.
 *
 * Locked shape (CONTEXT.md decisions § "View-name details"):
 *   _kbi_filt_u<sanitizedUserId>_d<dashId>_t<tableId>_s<sessionShort>
 *
 * - sanitizedUserId: alphanumeric+underscore, max 32 chars (per V13-P-08)
 * - sessionShort: first 8 hex chars of sessionId (~16M+ entropy; minimal
 *   collision risk for typical concurrent-user counts)
 * - Total length stays well under Kinetica's 200-char identifier limit
 *   (worst case ~120 chars: 32 + 9 + 9 + 8 + separators)
 *
 * S4 outcome (SPIKE-V13-04): BOTH FORMS WORK. Both `ki_home._kbi_filt_...`
 * (qualified) and `_kbi_filt_...` (unqualified) render PNG tiles via WMS
 * GetMap. Endpoint returns the UNQUALIFIED bare view name — no schema
 * lookup required, no `schema` parameter on this builder. See
 * .planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md § S4.
 *
 * Pure module — zero imports beyond the Node stdlib (none used here).
 * No Express, db, or kinetica.ts dependencies — keeps the unit-test
 * surface minimal and the module reusable across phases.
 */

/**
 * Sanitize an arbitrary userId/username for safe interpolation into a
 * Kinetica view-name identifier.
 *
 * - Replaces any character outside `[a-zA-Z0-9_]` with `_`
 * - Truncates the result to 32 chars max (V13-P-08 OIDC userId pitfall)
 *
 * Examples:
 *   sanitizeForViewName("alice")                  -> "alice"
 *   sanitizeForViewName("john.doe@kinetica.com")  -> "john_doe_kinetica_com"
 *   sanitizeForViewName("auth0|abc123def456")     -> "auth0_abc123def456"
 *   sanitizeForViewName("a".repeat(50))           -> "aaaa..." (32 chars)
 */
export function sanitizeForViewName(username: string): string {
  return username.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32);
}

export type FilterViewNameArgs = {
  username: string;
  sessionId: string;
  dashboardId: number;
  tableId: number;
};

/**
 * Build the deterministic transient-view name for a given
 * (user, session, dashboard, table) tuple.
 *
 * Shape: `_kbi_filt_u<sanitizedUserId>_d<dashId>_t<tableId>_s<sessionShort>`
 *
 * Pure / deterministic: same input always produces the same output.
 * No Date.now, no random, no env reads.
 */
export function buildFilterViewName(args: FilterViewNameArgs): string {
  const u = sanitizeForViewName(args.username);
  const s = args.sessionId.slice(0, 8);
  return `_kbi_filt_u${u}_d${args.dashboardId}_t${args.tableId}_s${s}`;
}
