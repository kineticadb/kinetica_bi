// 137-10: AI Assistant widget shell. Presentation follows the 36-col config.layout size (never pixels):
// large tile = inline chat; small tile = ask bar + history drawer + one-line last result.
// Gate order: permission -> server configured -> dashboard context. All hooks run before any return.
import { useEffect, useRef, useState } from "react";
import { resolveRect, type GridRect } from "@kinetica-bi/shared";
import type { WidgetDto } from "../../api/client";
import { useAuthStore } from "../../store/auth";
import { PERMISSIONS } from "../../lib/permissions";
import { useDashboardContextOptional } from "../DashboardContext";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { useAiConfigured } from "../../lib/aiSession/aiAvailability";
import { runAsk } from "../../lib/aiSession/askRunner";
import { takeGenerateIntent } from "../../lib/aiSession/generateIntent";
import { AI_CHAT_COPY } from "../../lib/aiSession/chatText";
import { isSmallAiTile } from "../../lib/aiSession/constants";
import { AiChat, AiAskBox, AiRunStatus } from "./AiChat";
import { AiDrawer } from "./AiDrawer";
import "./AiWidget.css";

export function AiWidgetRenderer({ widget }: { widget: WidgetDto }) {
  const canUse = useAuthStore((s) => s.hasPermission)(PERMISSIONS.AI_USE);
  const configured = useAiConfigured(canUse);
  const ctx = useDashboardContextOptional()?.ai;
  const [open, setOpen] = useState(false);
  const historyRef = useRef<HTMLButtonElement>(null);
  const lastTurn = useAiSessionStore((s) => (s.turns.length ? s.turns[s.turns.length - 1] : null));
  const running = useAiSessionStore((s) => s.run.status === "running");

  // 142 Pattern 3: the one exception to "asks start only from user handlers". The New Dashboard form stored a
  // TAKE-ONCE intent; reading it clears it, so StrictMode's second effect run (or any re-render) finds nothing
  // and only one ask is POSTed. The server derives generate mode itself (pending + empty), so Retry needs nothing here.
  useEffect(() => {
    if (!canUse || configured !== true || !ctx) return;
    const intent = takeGenerateIntent(ctx.dashboardId);
    if (intent) void runAsk(ctx, intent.question);
  }, [canUse, configured, ctx]);

  const notice = (text: string) => (
    <div className="ai-widget-notice muted" role="note">
      {text}
    </div>
  );
  if (!canUse) return notice(AI_CHAT_COPY.noAccess);
  if (configured === false) return notice(AI_CHAT_COPY.notConfigured);
  if (!ctx) return notice(AI_CHAT_COPY.unavailable);

  const rect = resolveRect(widget.config?.layout as Partial<GridRect> | undefined, 0);
  if (!isSmallAiTile(rect)) {
    return (
      <div className="ai-widget">
        <AiChat ctx={ctx} variant="inline" />
      </div>
    );
  }

  let lastLine = "";
  if (lastTurn && !running) {
    const status = lastTurn.chat?.status ?? "ok";
    if (status === "ok") lastLine = (lastTurn.answer ?? "").split("\n")[0];
    else if (status === "cancelled") lastLine = AI_CHAT_COPY.cancelled;
    else lastLine = lastTurn.chat?.message ?? "";
  }

  return (
    <div className="ai-widget ai-widget--small">
      <div className="ai-tile-bar">
        <button
          ref={historyRef}
          type="button"
          className="ghost-sm"
          aria-label="Open conversation"
          title="Open conversation"
          onClick={() => setOpen(true)}
        >
          History
        </button>
        <AiAskBox ctx={ctx} />
      </div>
      <AiRunStatus />
      <div className="ai-tile-last muted" title={lastLine}>
        {lastLine}
      </div>
      {open && (
        <AiDrawer
          ctx={ctx}
          onClose={() => {
            setOpen(false);
            historyRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
