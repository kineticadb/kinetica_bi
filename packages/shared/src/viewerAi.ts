// 152: per-dashboard Viewer AI (VIEWAI-V22-01..04). One spelling for server, web and specs.
export const VIEWER_AI_MODES = ["off", "answers_filters", "session_only"] as const;
export type ViewerAiMode = (typeof VIEWER_AI_MODES)[number];
export const DEFAULT_VIEWER_AI_MODE: ViewerAiMode = "session_only";

export function isViewerAiMode(v: unknown): v is ViewerAiMode {
  return typeof v === "string" && (VIEWER_AI_MODES as readonly string[]).includes(v);
}

export const VIEWER_AI_LABEL: Record<ViewerAiMode, string> = {
  off: "Off",
  answers_filters: "Answers and filters",
  session_only: "Session only",
};

/** Refusal code (HTTP 423) for an ask or Apply blocked by the dashboard's Viewer AI mode. */
export const VIEWER_AI_OFF_CODE = "AI_VIEWER_OFF";
export const VIEWER_AI_OFF_MESSAGE = "AI is off for this dashboard.";
/** Gateway refusal reasons for a restricted user. */
export const VIEWER_AI_AF_REASON = "Viewer AI: answers and filters only";
export const VIEWER_AI_OFF_REASON = "Viewer AI: off for this dashboard";
