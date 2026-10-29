// kbi-mcp: the text widget's settings: one markdown box.
import type { ConfigPanelProps } from "./registry";

export const TEXT_WIDGET_MAX_CHARS = 4000;

export default function TextConfigPanel({ config, onChange }: ConfigPanelProps): JSX.Element {
  const markdown = typeof config.markdown === "string" ? config.markdown : "";
  return (
    <div className="config-group" role="group" aria-labelledby="text-widget-label">
      <label id="text-widget-label" className="config-group-label">
        TEXT
      </label>
      <textarea
        className="config-textarea"
        aria-label="Text (Markdown)"
        rows={12}
        maxLength={TEXT_WIDGET_MAX_CHARS}
        value={markdown}
        onChange={(e) => onChange({ ...config, markdown: e.target.value })}
      />
      <div className="config-hint">
        Markdown: # headings, **bold**, *italic*, - lists, 1. lists, | tables |, [links](https://…). HTML is shown as text.
      </div>
    </div>
  );
}
