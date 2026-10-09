// Phase 131 (EXPRT-V126-12): a plain navigation lets the browser's download manager own the transfer (pause/resume via Range),
// but a JSON 4xx would replace the SPA, so a 1-byte Range preflight goes first.
import { exportDownloadUrl, preflightExportDownload } from "../api/client";
import { useToastStore } from "../store/toast";

export const EXPORT_NETWORK_ERROR_MESSAGE = "Could not reach the server. Check your connection and try again.";

// Test seam: jsdom cannot spy on window.location.assign.
export const __assignLocation = { fn: (url: string) => window.location.assign(url) };

/** true = navigated; false = an error toast was shown (or the session ended). */
export async function startExportDownload(id: string): Promise<boolean> {
  let result;
  try {
    result = await preflightExportDownload(id);
  } catch {
    useToastStore.getState().showToast(EXPORT_NETWORK_ERROR_MESSAGE, "error");
    return false;
  }
  if (!result.ok) {
    // 401: apiFetch already dispatched UNAUTHORIZED_EVENT; the login screen takes over, no toast.
    if (result.status !== 401) useToastStore.getState().showToast(result.message, "error");
    return false;
  }
  __assignLocation.fn(exportDownloadUrl(id));
  return true;
}
