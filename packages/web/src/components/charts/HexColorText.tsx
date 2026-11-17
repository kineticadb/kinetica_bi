import React, { useEffect, useState } from "react";

/**
 * Quick 261117-hex: a hex text box that sits next to a native color picker.
 * Shows `value` as "#rrggbb"; accepts typed or pasted hex with or without "#" (6 digits).
 * A partial value stays in the box but is not saved; leaving the box restores the saved color.
 */
export function HexColorText({
  value,
  onChange,
  ariaLabel,
  className = "config-color-text",
  style,
}: {
  value: string; // "#rrggbb" (or "rrggbb")
  onChange: (hex: string) => void; // always "#rrggbb", lowercase
  ariaLabel: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const shown = `#${value.replace(/^#/, "").toLowerCase()}`;
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  return (
    <input
      type="text"
      className={className}
      aria-label={ariaLabel}
      placeholder="#hex"
      spellCheck={false}
      maxLength={7}
      value={draft}
      style={style}
      onChange={(e) => {
        const text = e.target.value.trim();
        setDraft(text);
        const m = /^#?([0-9a-fA-F]{6})$/.exec(text);
        if (m) onChange(`#${m[1].toLowerCase()}`);
      }}
      onBlur={() => setDraft(shown)}
    />
  );
}
