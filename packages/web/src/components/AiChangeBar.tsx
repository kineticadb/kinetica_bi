import { useState } from "react";
import type { WidgetDto, DashboardLayerDto } from "../api/client";
import { useAiSessionStore, selectHasUnsavedAiChanges } from "../store/aiSessionStore";
import { computeChangeCounts } from "../lib/aiSession/changeCounts";
import { AI_CHAT_COPY } from "../lib/aiSession/chatText";
import AiDiscardDialog from "./AiDiscardDialog";

/**
 * 137 D-15/D-19: unsaved-AI-changes bar. Visibility follows the lock (any op ever applied), not the
 * counts, so it stays at cursor -1 (Pitfall 5).
 */
export function AiChangeBar({
  savedWidgets,
  savedLayers,
}: {
  savedWidgets: readonly WidgetDto[];
  savedLayers: readonly DashboardLayerDto[];
}) {
  const visible = useAiSessionStore(selectHasUnsavedAiChanges);
  const derived = useAiSessionStore((s) => s.derived);
  const [confirming, setConfirming] = useState(false);
  if (!visible) return null;

  const { added, edited, removed, removedNames } = computeChangeCounts(derived, {
    widgets: savedWidgets,
    layers: savedLayers,
  });
  const allZero = added + edited + removed === 0;

  return (
    <div className="ai-change-bar" role="status">
      <span className="ai-change-bar-text">
        {allZero ? (
          "Unsaved AI changes: none shown at this point."
        ) : (
          <>
            Unsaved AI changes: {added} added · {edited} edited ·{" "}
            {removed > 0 ? (
              <span className="ai-change-bar-removed" title={removedNames.join(", ") || undefined}>
                {removed} removed
              </span>
            ) : (
              "0 removed"
            )}
            .
          </>
        )}{" "}
        {AI_CHAT_COPY.lockedSuffix}
      </span>
      <div className="ds-actions">
        {/* 137 D-16: Keep is disabled until Phase 141; 141 enables it and MUST call reset() so removal approval clears. */}
        <button type="button" className="btn-primary btn-sm" disabled title={AI_CHAT_COPY.keepSoon}>
          Keep
        </button>
        <button type="button" className="ghost-sm" onClick={() => setConfirming(true)}>
          Discard
        </button>
      </div>
      {confirming && <AiDiscardDialog onClose={() => setConfirming(false)} />}
    </div>
  );
}
