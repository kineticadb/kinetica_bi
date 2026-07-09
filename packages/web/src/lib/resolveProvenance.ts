// Phase 107 Plan 01 (FPANEL-V120-08): pure 1-hop provenance resolver.
//
// Resolves a filter's sourceWidgetId to a human-readable "from {widget title}"
// string, for display as a muted subtitle on a panel-variant FilterChip.
// Deliberately NOT a reverse-map (that's Phase 108's resolveWidgetsForFilter) —
// this is a single, direct id -> widget lookup.
//
// Returns undefined (never "from Unknown") when the id is absent or unresolved,
// so callers can omit the provenance line gracefully.

import type { WidgetDto } from "../api/client";

export function resolveProvenance(
  sourceWidgetId: number | undefined,
  widgets: WidgetDto[]
): string | undefined {
  if (sourceWidgetId === undefined) return undefined;
  const w = widgets.find((w) => w.id === sourceWidgetId);
  return w ? `from ${w.title}` : undefined; // literal template locked by 107-CONTEXT.md
}
