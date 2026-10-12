# Phase 134 — Operator Browser-Check Gaps (134-09 checkpoint, 2026-10-12)

## Results so far (operator, real browser, dev harness)
- Step 1 (add widget + lock): PASS — toolbar greyed, notice shown, tooltip present on hover (visible in operator screenshot).
- Step 2 (layout protection): PASS — saved widgets did not move.
- Step 3 (patch / revert / forward): FAIL — see gaps below. Steps 4-9 not yet run.

## GAP-134-01 (confirmed root cause) — map overlay keys never read
`patchWidget(<mapId>, { show_scale_bar: false })` / `{ show_popup: false }` → applied (`status: applied`), written to `widgetOverrides`, but **no visible effect**.
- Allow-list (`packages/shared/src/actionAllowList.ts:107-114`) declares snake_case `show_popup`, `show_scale_bar`, `show_fullscreen` at `widget.config`.
- `WidgetRenderer.tsx:351-359` merges overrides into `effectiveWidget.config` correctly.
- `MapChartRenderer.tsx:451-456` reads only camelCase `showScaleBar`, `showFullscreenButton`; popups are governed by `infoEnabled` (`lib/mapInfoConfig.ts` `getInfoEnabled`). No `show_*` read anywhere.
- Inherited from v1.11 (Phase 58) radio allow-list (`lib/radioGroupCapture.ts:46`) → **v1.11 radio options targeting these map fields have never worked either.**
- Not caught because no spec asserts an allow-listed field changes the RENDERED map.
- Also: `show_scale_bar: false` equals the default (`DEFAULT_SHOW_SCALE_BAR = false`) — the operator's test could not show a change even if wired.
- Operator decision: fix now as a Phase 134 gap plan (translate keys at the WidgetRenderer→MapChartRenderer seam; fixes AI + radio), with a rendered-effect test.

## GAP-134-02 (not reproduced) — revert/forward "did nothing"
Debugger drove the same sequence through the real harness on a rendered DashboardOpen: every cursor move rendered correctly (AI widgets appear/disappear; overlays follow). Likely operator-facing confusion: turn indices include invisible patch turns (AI 2 was turn 3, not 2), and the lock/notice intentionally stay on after `revert(-1)`. Remaining risk: real react-grid-layout (mocked in jsdom). Fix: make harness `revert`/`forward` (and `turn`) print the cursor, turn count and the visible AI widget titles so the operator can see the effect; operator re-checks `revert(-1)` live.
