import { hasPendingProposal, hasUnsavedAiChanges, useAiSessionStore } from "../store/aiSessionStore";

/**
 * D-15 warn-first leave guard. There is no router, so every in-app leave path calls this
 * before navigating: clean session -> proceed() synchronously; unsaved AI changes -> park
 * `proceed` in pendingLeave so <AiLeaveDialog/> can ask first.
 *
 * 150: a pending proposal also warns; it is recorded as not decided by the server already.
 *
 * Logout / 401 does NOT use this (not promptable; it resets the session unconditionally).
 * popstate and beforeunload are handled in DashboardsPage (134-08).
 */
export function requestLeave(proceed: () => void): void {
  if (!hasUnsavedAiChanges() && !hasPendingProposal()) {
    proceed();
    return;
  }
  useAiSessionStore.getState().setPendingLeave({ proceed });
}
