// 142 (Pattern 3): the generate form hands the first ask to the open dashboard as a TAKE-ONCE intent.
// Module state, deliberately outside aiSessionStore (reset() restores `initial` and bumps the epoch).
// Read-and-clear makes a StrictMode double effect harmless: the second take finds nothing.
export const GENERATE_DEFAULT_QUESTION = "Create a starter dashboard for this table.";

let intent: { dashboardId: number; question: string } | null = null;

export function setGenerateIntent(dashboardId: number, question: string): void {
  intent = { dashboardId, question: question.trim() ? question.trim() : GENERATE_DEFAULT_QUESTION };
}

export function takeGenerateIntent(dashboardId: number): { question: string } | null {
  if (!intent || intent.dashboardId !== dashboardId) return null;
  const { question } = intent;
  intent = null;
  return { question };
}

export function __resetGenerateIntentForTest(): void {
  intent = null;
}
