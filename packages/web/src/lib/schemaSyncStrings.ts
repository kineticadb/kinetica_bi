/**
 * Phase 126 Plan 02 (SSYNC-V125-01) — a MIRROR, not a copy of convenience.
 *
 * SCHEMA_APPLY_TEXT_WIDTH_GAP is authored in `packages/server/src/lib/schemaApply.ts:146`.
 * It reaches NO response body — `index.ts` references it nowhere — and this repo has no
 * cross-package imports, so the web cannot import it. ROADMAP Phase 126 criterion 6's
 * wording ("the UI imports the constant") is therefore not literally achievable;
 * 126-CONTEXT.md records that correction and mandates this mirror instead. Adding the
 * constant to the apply response would be a `packages/server` change, which this phase
 * explicitly does not make.
 *
 * PARITY IS ENFORCED, not assumed: `schemaSyncStrings.spec.ts` reads the server source,
 * reassembles the three-segment concatenation below and compares it byte-for-byte.
 * **If you edit either side you MUST edit the other, or that spec reddens.**
 *
 * The other five approved operator-facing strings are deliberately NOT mirrored here:
 * they all arrive in `response.message`, so rendering them verbatim is just rendering the
 * wire value. Mirroring them would create five more drift surfaces for no gain.
 */
export const SCHEMA_APPLY_TEXT_WIDTH_GAP =
  "Kinetica's /show/table carries no marker for an unrestricted-length string column, so " +
  "a column INFORMATION_SCHEMA reported as `text` is stored as `string` after an apply and " +
  "becomes selectable in the drill-down picker. This report does NOT detect that case.";
