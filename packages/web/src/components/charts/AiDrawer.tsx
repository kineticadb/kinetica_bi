// 137-10: full conversation drawer for small AI tiles. Portalled to <body>: grid CSS transforms
// trap position:fixed inside widgets, and StrictMode double effects steal autoFocus (focus in an effect).
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { AskContext } from "../../lib/aiSession/askRunner";
import { AiChat } from "./AiChat";
import "./AiWidget.css";

export function AiDrawer({ ctx, onClose }: { ctx: AskContext; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return createPortal(
    <div className="modal-overlay ai-drawer-overlay" onClick={onClose}>
      <aside
        className="ai-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-drawer-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="modal-header">
          <span className="modal-title" id="ai-drawer-title">
            AI Assistant
          </span>
          <button ref={closeRef} type="button" className="ghost-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="ai-drawer-body">
          <AiChat ctx={ctx} variant="drawer" />
        </div>
      </aside>
    </div>,
    document.body,
  );
}
