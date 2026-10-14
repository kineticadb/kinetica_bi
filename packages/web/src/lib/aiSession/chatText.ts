// 137: all user-facing copy for the AI widget/bar lives here so UI and specs share exact text.

export const AI_CHAT_COPY = {
  emptyHint: "Ask about this dashboard's data",
  noAccess: "You don't have access to the AI assistant",
  notConfigured: "The AI assistant isn't set up on this server.",
  unavailable: "The AI assistant is not available here.",
  cancelled: "Cancelled, nothing changed",
  revert: "Revert dashboard to this state",
  keepSoon: "Saving AI changes is coming soon",
  discardTitle: "Discard all AI changes?",
  discardBody: "This removes every change the AI made and clears the conversation.",
  lockedSuffix: "Editing is locked until they are kept or discarded.",
  askPlaceholder: "Ask a question about this dashboard",
  retry: "Retry",
} as const;

export const TOOL_PROGRESS: Record<string, string> = {
  add_widget: "Adding a chart…",
  edit_widget: "Updating a chart…",
  rename_widget: "Renaming a widget…",
  change_widget_type: "Changing a chart type…",
  set_layout: "Arranging the layout…",
  add_heatmap_layer: "Adding a heatmap layer…",
  edit_heatmap_layer: "Updating a heatmap layer…",
  set_layer_visibility: "Changing layer visibility…",
  patch: "Updating a widget…",
  remove_widget: "Removing a widget…",
  remove_layer: "Removing a layer…",
  remove_dynamic_view: "Removing a dynamic view…",
  get_dashboard: "Reading the dashboard…",
  list_tables: "Looking at the tables…",
  describe_table: "Reading the table columns…",
};

export const TOOL_NOUN: Record<string, string> = {
  add_widget: "add a chart",
  edit_widget: "change a chart",
  rename_widget: "rename a widget",
  change_widget_type: "change a chart type",
  set_layout: "move or resize widgets",
  add_heatmap_layer: "add a heatmap layer",
  edit_heatmap_layer: "change a heatmap layer",
  set_layer_visibility: "change layer visibility",
  patch: "change a widget",
  remove_widget: "remove a widget",
  remove_layer: "remove a layer",
  remove_dynamic_view: "remove a dynamic view",
};

// Structural types: shared AskStreamEvent / AskSkipped are assignable to these.
export type ProgressEv =
  | { event: "status"; data: { phase: string; label: string; seconds?: number } }
  | { event: "step"; data: { n: number; tool: string; label: string } }
  | { event: string; data: unknown };
export type SkippedLike = { label: string; stage: string; reasons: string[] };

export function friendlyProgressLabel(ev: ProgressEv): string | null {
  if (ev.event === "step") {
    const d = ev.data as { tool?: string; label?: string };
    if (d.tool && TOOL_PROGRESS[d.tool]) return TOOL_PROGRESS[d.tool];
    return d.label ?? null;
  }
  if (ev.event === "status") {
    const d = ev.data as { phase?: string; label?: string; seconds?: number };
    if (d.phase === "waiting_provider") return `Waiting for the AI provider, retrying in ${d.seconds ?? 0}s…`;
    if (d.phase === "thinking") return "Thinking…";
    return d.label ?? null;
  }
  return null;
}

export function formatElapsed(ms: number): string {
  if (ms < 10_000) return "";
  return ` · ${Math.floor(ms / 1000)}s`;
}

export function describeSkipped(s: SkippedLike): string | null {
  if (s.stage === "clarification") return null;
  const what = /^[a-z_]+$/.test(s.label) ? (TOOL_NOUN[s.label] ?? "make a change") : s.label;
  const reason = s.reasons[0];
  return reason ? `Couldn't do: ${what} (${reason.slice(0, 160)})` : `Couldn't do: ${what}`;
}
