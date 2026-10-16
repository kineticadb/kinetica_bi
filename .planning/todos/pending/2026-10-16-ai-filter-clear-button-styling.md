---
created: 2026-10-16T12:00:00.000Z
title: Make the AI chat "Clear this filter" button distinct from follow-up buttons
area: ui
files:
  - packages/web/src/components/charts/AiChat.tsx
  - packages/web/src/components/charts/AiChat.css
  - packages/web/src/styles/global.css
---

## Problem

Found in the Phase 138 operator UAT (observation 2). The zero-row "Clear this filter" button in AiChat is a plain `ghost-sm`, visually identical to the follow-up suggestion buttons rendered right below it, so it is easy to miss.

## Solution

Give it distinct styling or placement, reusing existing classes only (CLAUDE.md): for example `ghost-sm ghost-danger`, or group it with the "matched no rows" note instead of the follow-ups. Do not invent new class names without grepping `global.css`. Verify visually in light and dark (theme-guard and tests will not catch CSS mistakes).
