// 138: every user-facing AI filter note. Pure strings; used by the apply wiring (138-06) and the UI (138-07).
const w = (n: number): string => `${n} widget${n === 1 ? "" : "s"}`;

export const AI_FILTER_COPY = {
  clearThisFilter: "Clear this filter",
  filtered: (source: string, chips: string, n: number) => `Filtered ${source} to ${chips} (${w(n)}).`,
  alreadyFiltered: (source: string, chips: string) => `${source} was already filtered to ${chips}.`,
  clearedColumn: (column: string, source: string, n: number) => `Cleared the ${column} filter on ${source} (${w(n)}).`,
  clearedSource: (source: string, n: number) => `Cleared the filters on ${source} (${w(n)}).`,
  clearedAll: (n: number) => `Cleared all filters (${w(n)}).`,
  stillOn: (cols: readonly string[]) =>
    cols.length === 1
      ? `Your ${cols[0]} filter is still on.`
      : `Your ${cols.slice(0, -1).join(", ")} and ${cols[cols.length - 1]} filters are still on.`,
  shapesLeft: "Drawn map shapes were left on.",
  matchedNoRows: (column: string, source: string) => `The ${column} filter on ${source} matched no rows.`,
  skippedCap: (source: string) => `Skipped a filter on ${source}: it already has 25 filters. Clear some first.`,
  skippedColumn: (column: string, source: string) => `Skipped a filter: ${source} has no column ${column}.`,
  // D-18: allow-list (filterSelection) widgets / scoped layers do not take AI filters; say so
  skippedScoped: (n: number) =>
    n === 1 ? "1 widget with its own filter selection was not filtered." : `${n} widgets with their own filter selection were not filtered.`,
} as const;
