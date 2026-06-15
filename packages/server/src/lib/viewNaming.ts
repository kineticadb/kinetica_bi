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
  /**
   * Table-path source id. Required UNLESS `dynamicViewId` is supplied.
   * When present (and `dynamicViewId` absent), emits the byte-unchanged
   * `_t<tableId>` segment.
   */
  tableId?: number;
  /**
   * Dynamic-view-path source id (DVDRILL-V112-03). When present, swaps the
   * `_t<tableId>` segment for `_dv<dynamicViewId>` so the dv-filter view name
   * is distinct from BOTH the table-filter view (`_t<id>`) and the dv's own
   * materialized view (`_kbi_dv_..._<id>`). Exactly one of `tableId` /
   * `dynamicViewId` must be provided (both-undefined throws — no silent
   * `_tundefined`).
   */
  dynamicViewId?: number;
};

/**
 * Build the deterministic transient-view name for a given
 * (user, session, dashboard, source) tuple.
 *
 * Shape (table path):  `_kbi_filt_u<sanitizedUserId>_d<dashId>_t<tableId>_s<sessionShort>`
 * Shape (dv path):     `_kbi_filt_u<sanitizedUserId>_d<dashId>_dv<dynamicViewId>_s<sessionShort>`
 *
 * Exactly one of `tableId` / `dynamicViewId` is required — supplying neither
 * throws (a runtime guard; since both fields are optional, tsc can no longer
 * catch a caller that supplies neither, which would silently emit
 * `_tundefined`). When `dynamicViewId` is absent the output is byte-identical
 * to the original table-path form (back-compat regression-locked).
 *
 * Pure / deterministic: same input always produces the same output.
 * No Date.now, no random, no env reads.
 */
export function buildFilterViewName(args: FilterViewNameArgs): string {
  if (args.dynamicViewId === undefined && args.tableId === undefined) {
    throw new Error(
      "buildFilterViewName: tableId or dynamicViewId required"
    );
  }
  const u = sanitizeForViewName(args.username);
  const s = args.sessionId.slice(0, 8);
  const segment =
    args.dynamicViewId !== undefined
      ? `dv${args.dynamicViewId}`
      : `t${args.tableId}`;
  return `_kbi_filt_u${u}_d${args.dashboardId}_${segment}_s${s}`;
}
