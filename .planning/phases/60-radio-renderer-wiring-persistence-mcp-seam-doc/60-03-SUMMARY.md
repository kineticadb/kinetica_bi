---
phase: 60-radio-renderer-wiring-persistence-mcp-seam-doc
plan: 03
subsystem: ui
tags: [documentation, mcp, ai-seam, widget-action, allow-list, seam]

# Dependency graph
requires: ["60-01"]
provides:
  - "packages/web/docs/mcp-action-seam.md — MCP/AI seam design doc (SEAM-V111-01)"
  - "Code-comment pointer at applyWidgetAction.ts module header"
  - "Existence + content-assert test in applyWidgetAction.spec.ts"
affects:
  - "AI-V2-01 / AI-V2-02 (future AI/MCP milestone — this doc is the bridge)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Doc-existence test: readFileSync the doc from spec, assert required section strings present"
    - "Code-comment pointer in module header referencing doc path"

key-files:
  created:
    - "packages/web/docs/mcp-action-seam.md — MCP/AI seam design doc (DOC-ONLY)"
  modified:
    - "packages/web/src/lib/applyWidgetAction.ts — added single comment-pointer line (no runtime change)"
    - "packages/web/src/lib/applyWidgetAction.spec.ts — added 8 SEAM-V111-01 existence/content-assert tests"

key-decisions:
  - "DOC-ONLY: no AI widget, no MCP server, no @modelcontextprotocol/sdk dependency added"
  - "mcp-action-seam.md placed in packages/web/docs/ (new directory) per plan discretion"
  - "Test resolves doc path via resolve(__dirname, '../../docs/mcp-action-seam.md') from spec dir"
  - "Comment pointer is a single line inside the existing JSDoc block — no runtime diff"

# Metrics
duration: 5min
completed: 2026-06-10
---

# Phase 60 Plan 03: MCP Action Seam Documentation Summary

**MCP/AI seam design doc documenting applyWidgetAction + the {target,configPatch} envelope as the future AI/MCP hook, with allow-list as the safety boundary, concrete MCP tool shape (WidgetActionSchema as inputSchema, existing PATCH routes), and explicit NOT-BUILT v1.11 scope**

## Performance

- **Duration:** 5 min
- **Started:** 2026-06-11T00:17:22Z
- **Completed:** 2026-06-11T00:22:xx Z
- **Tasks:** 2
- **Files modified:** 3 (1 created: mcp-action-seam.md; 2 modified: applyWidgetAction.ts + spec)

## Accomplishments

- Created `packages/web/docs/mcp-action-seam.md` (new `docs/` directory) covering:
  - Scope banner: explicitly NOT BUILT in v1.11 (no AI widget, no MCP server)
  - Where it lives: `applyWidgetAction` + `WidgetActionSchema` + `actionAllowList`
  - Envelope contract: fully serializable `{target:{kind,id}, configPatch}` shape
  - Safety boundary: `validateActionPatch` + `ALLOW_LIST_VERSION = "v2"` + `getFieldLocation`; full allow-list seed table with per-field location metadata
  - Concrete MCP tool shape: `WidgetActionSchema` as `inputSchema`; `apply_widget_action` tool handler validates then calls existing PATCH routes (no new routes)
  - In-app vs MCP persistence difference: same envelope + same allow-list, different sink
  - Future extensibility notes
- Added comment-pointer line to `applyWidgetAction.ts` module header: `MCP/AI seam documentation: packages/web/docs/mcp-action-seam.md` — comment only, zero runtime diff
- Added 8-test `describe("MCP action seam doc (SEAM-V111-01)")` block to `applyWidgetAction.spec.ts`: readFileSync asserts on all required doc sections + pointer comment in source

## Task Commits

Each task was committed atomically:

1. **Task 1: Write mcp-action-seam.md + comment pointer** — `93a25c3` (docs)
2. **Task 2: Add seam-doc existence/content-assert test** — `162e514` (test)

## Test Gates

| Gate | Result |
|------|--------|
| `cd packages/web && npx vitest run` | 1935/1935 passed (92 files) — 8 new SEAM-V111-01 doc-assert tests |
| `cd packages/web && npx tsc --noEmit` | Clean (exit 0) |
| `git status --porcelain packages/server` | Empty — zero server changes |
| `applyWidgetAction.ts` runtime diff | Comment-only (`git diff` shows single line added in JSDoc block) |

## Deviations from Plan

None — plan executed exactly as written.

- Doc path `packages/web/docs/mcp-action-seam.md` (plan said "e.g. in the repo docs or a phase artifact" — this is the web package docs directory)
- Path resolution in test: `resolve(__dirname, "../../docs/mcp-action-seam.md")` — `__dirname` is `packages/web/src/lib/`, so `../../` reaches `packages/web/`, then `docs/`. Corrected from an initial `../../../` (3 levels) to `../../` (2 levels) after first test run showed wrong path.

## Self-Check

- [x] `packages/web/docs/mcp-action-seam.md` exists — verified
- [x] `grep -ni "inputSchema"` — matches (3 lines)
- [x] `grep -ni "ALLOW_LIST_VERSION"` — matches
- [x] `grep -ni "PATCH /api/widgets"` — matches
- [x] `grep -ni "no AI\|NOT BUILT\|NO MCP\|design.*only"` — matches
- [x] `grep -n "mcp-action-seam" applyWidgetAction.ts` — matches line 15
- [x] Commit `93a25c3` exists — confirmed
- [x] Commit `162e514` exists — confirmed
- [x] Zero packages/server diff — confirmed
- [x] 1935/1935 vitest green — confirmed
- [x] tsc --noEmit clean — confirmed

## Self-Check: PASSED

---
*Phase: 60-radio-renderer-wiring-persistence-mcp-seam-doc*
*Completed: 2026-06-10*
*Requirements closed: SEAM-V111-01*
