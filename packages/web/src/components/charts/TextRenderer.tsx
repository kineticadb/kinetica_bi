// kbi-mcp: the text widget shows markdown written by a user or a model (titles, notes, findings).
// renderMarkdown builds React elements only, so HTML in the text is shown literally (XSS boundary).
import type { WidgetDto } from "../../api/client";
import { renderMarkdown } from "../../lib/markdownText";
import "./TextWidget.css";

export default function TextRenderer({ widget }: { widget: WidgetDto }) {
  const markdown = typeof widget.config.markdown === "string" ? widget.config.markdown : "";
  if (markdown.trim() === "") {
    return (
      <div className="legend-widget-orphan" role="status">
        <div className="legend-widget-orphan-message">No text yet. Open this widget's settings to write some.</div>
      </div>
    );
  }
  return (
    <div className="text-widget" data-testid="text-widget">
      {renderMarkdown(markdown)}
    </div>
  );
}
