import { useState } from "react";
import type { WidgetDto, DashboardLayerDto } from "../api/client";
import { useAiSessionStore, selectHasUnsavedAiChanges } from "../store/aiSessionStore";
import { computeChangeCounts } from "../lib/aiSession/changeCounts";
import { AI_CHAT_COPY } from "../lib/aiSession/chatText";
import AiDiscardDialog from "./AiDiscardDialog";
import AiKeepDialog from "./AiKeepDialog";
import AiKeepConflictDialog from "./AiKeepConflictDialog";
import { useAuthStore } from "../store/auth";
import { PERMISSIONS } from "../lib/permissions";
import { countViewToggles } from "../lib/aiSession/keepPayload";
import type { KeepRunOutcome } from "../lib/aiSession/keepRunner";

/**
 * 137 D-15/D-19: unsaved-AI-changes bar. Visibility follows the lock (any op ever applied), not the
 * counts, so it stays at cursor -1 (Pitfall 5).
 */
export function AiChangeBar({
  savedWidgets,
  savedLayers,
  savedDynamicViews,
  onKeep,
  onReloadLatest,
  onDiscardGenerated,
}: {
  savedWidgets: readonly WidgetDto[];
  savedLayers: readonly DashboardLayerDto[];
  /** 139: saved views, so a session-removed saved view is named on hover. */
  savedDynamicViews?: readonly { id: number; name: string }[];
  /** 141: runs Keep (DashboardsPage wires runKeep). Absent -> Keep is disabled. */
  onKeep?: () => Promise<KeepRunOutcome>;
  /** 141 D-08: "Discard and reload the latest" after a 409. */
  onReloadLatest?: () => Promise<void>;
  /** 142 D-05: while the dashboard is an unkept generated one, Discard deletes it (owner shows GeneratedDiscardDialog). */
  onDiscardGenerated?: () => void;
}) {
  const visible = useAiSessionStore(selectHasUnsavedAiChanges);
  const derived = useAiSessionStore((s) => s.derived);
  const keepBlocked = useAiSessionStore((s) => s.keepBlocked);
  const running = useAiSessionStore((s) => s.run.status === "running");
  // 141 Pitfall 11: the RAW dashboards:edit permission, deliberately NOT the lock-ANDed canEdit (the AI lock would
  // always hide Keep). Partial rights (D-04) still see Keep and get the server's named refusal.
  const canKeep = useAuthStore((s) => s.hasPermission)(PERMISSIONS.DASHBOARDS_EDIT);
  const [confirming, setConfirming] = useState(false);
  const [keepOpen, setKeepOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  if (!visible) return null;

  const { added, edited, removed, removedNames } = computeChangeCounts(derived, {
    widgets: savedWidgets,
    layers: savedLayers,
    dynamicViews: savedDynamicViews,
  });
  const allZero = added + edited + removed === 0;
  const keepTitle = running
    ? AI_CHAT_COPY.keepBusy
    : allZero
      ? AI_CHAT_COPY.keepNothing
      : keepBlocked === "conflict"
        ? AI_CHAT_COPY.keepBlockedConflict
        : keepBlocked === "committed"
          ? AI_CHAT_COPY.keepCommittedNoRefresh
          : "";
  const keepDisabled = !onKeep || saving || keepTitle !== "";

  const save = async () => {
    setKeepOpen(false);
    setSaving(true);
    setError(null);
    const o = await onKeep!();
    setSaving(false);
    if (o.kind === "conflict") setConflictOpen(true);
    else if (o.kind === "error") setError(o.message);
  };

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
      {!canKeep && <span className="muted">{AI_CHAT_COPY.keepEditorsOnly}</span>}
      {keepBlocked === "conflict" && <span className="muted">{AI_CHAT_COPY.keepBlockedConflict}</span>}
      {keepBlocked === "committed" && (
        <span className="error" role="alert">
          {AI_CHAT_COPY.keepCommittedNoRefresh}
        </span>
      )}
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
      <div className="ds-actions">
        {/* 141: Keep never calls reset(); runKeep -> completeKeep owns the post-save state (D-21). */}
        {canKeep && (
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={keepDisabled}
            title={keepTitle}
            onClick={() => setKeepOpen(true)}
          >
            {saving ? AI_CHAT_COPY.keepSaving : "Keep"}
          </button>
        )}
        <button type="button" className="ghost-sm" disabled={saving} onClick={() => (onDiscardGenerated ? onDiscardGenerated() : setConfirming(true))}>
          Discard
        </button>
      </div>
      {keepOpen && (
        <AiKeepDialog
          counts={{ added, edited, removed }}
          viewTogglesNotSaved={countViewToggles(derived) > 0}
          onSave={() => void save()}
          onCancel={() => setKeepOpen(false)}
        />
      )}
      {conflictOpen && (
        <AiKeepConflictDialog
          onStay={() => setConflictOpen(false)}
          onReload={() => {
            setConflictOpen(false);
            void onReloadLatest?.();
          }}
        />
      )}
      {confirming && <AiDiscardDialog onClose={() => setConfirming(false)} />}
    </div>
  );
}
