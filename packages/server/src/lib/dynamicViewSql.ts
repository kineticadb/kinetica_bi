/**
 * Pure SQL helper: substitute the `{view}` token in a dynamic-view template
 * with the source filter-view's materialized name.
 *
 * Locked decisions (32-CONTEXT.md § D1):
 *  - Single placeholder: `{view}`.
 *  - Case-insensitive (`{View}` / `{VIEW}` accepted).
 *  - Whitespace-tolerant around the token (`{ view }` accepted).
 *  - GLOBAL replace — every occurrence in the template is substituted.
 *  - If no occurrence is found, throws `MissingViewTokenError`. This is a
 *    configuration error: a dynamic view that does NOT reference the source
 *    filter view would bypass the threshold gate (CONTEXT.md D1 rationale).
 *
 * Pure module — zero imports beyond the JS stdlib (none used here).
 * No Express, no db, no kinetica.ts.
 */

export class MissingViewTokenError extends Error {
  constructor(message?: string) {
    super(message ?? "Dynamic view template must contain a {view} token.");
    this.name = "MissingViewTokenError";
  }
}

const VIEW_TOKEN_RE = /\{\s*view\s*\}/gi;

export function substituteViewToken(template: string, viewName: string): string {
  // Reset lastIndex BEFORE .test() because /g regex retains state across
  // .test()/.exec() calls — without this, the second invocation of this
  // helper in the same process can silently no-op.
  VIEW_TOKEN_RE.lastIndex = 0;
  if (!VIEW_TOKEN_RE.test(template)) {
    throw new MissingViewTokenError();
  }
  // Reset again because .test() advanced lastIndex; .replace with /g is
  // independent of lastIndex but resetting keeps the regex pristine for any
  // future caller that does a different operation.
  VIEW_TOKEN_RE.lastIndex = 0;
  return template.replace(VIEW_TOKEN_RE, viewName);
}
