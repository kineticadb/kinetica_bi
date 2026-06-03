/**
 * Phase 22 (CONFIG-V14-03) — Custom chip-combobox for the layer info-popup column picker.
 *
 * Why custom (not a library): bundle target was <20 KB gzip per 22-CONTEXT.md; smallest
 * mainstream React combobox libraries (react-select v5: ~30KB, @headlessui/react Combobox:
 * ~12KB but requires Tailwind ergonomics, cmdk: ~7KB but command-palette UX), so a 50-line
 * custom build that matches existing config-group styling wins on bundle + visual parity.
 *
 * `null` selected sentinel: when caller passes selected=null, ALL chips render as selected
 * (visually communicates "all columns are included by default"). The very first deselect
 * fires onChange with the explicit string[] of remaining options. The caller (Plan 22-03
 * KineticaWmsLayerForm) is responsible for compressing back to null when the user re-selects
 * everything — that policy is NOT in this component.
 */
import { useMemo } from "react";

export type ChipComboboxOption = { value: string; typeLabel?: string };
export type ChipComboboxProps = {
  options: ChipComboboxOption[];
  selected: string[] | null;
  onChange: (next: string[] | null) => void;
  disabled?: boolean;
  ariaLabel?: string;
};

export default function ChipCombobox({
  options,
  selected,
  onChange,
  disabled = false,
  ariaLabel,
}: ChipComboboxProps): JSX.Element {
  const selectedSet = useMemo(
    () =>
      selected === null
        ? new Set(options.map((o) => o.value))
        : new Set(selected),
    [selected, options],
  );

  const handleClick = (value: string) => {
    if (disabled) return;
    // Materialize from null sentinel on first deselect:
    const baseline =
      selected === null ? options.map((o) => o.value) : selected;
    if (selectedSet.has(value)) {
      onChange(baseline.filter((v) => v !== value));
    } else {
      onChange([...baseline, value]);
    }
  };

  return (
    <div
      className="info-popup-config-chips"
      role="group"
      aria-label={ariaLabel ?? "Selectable chips"}
    >
      {options.map((opt) => {
        const isSelected = selectedSet.has(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            className={`info-popup-config-chip${isSelected ? " selected" : ""}`}
            onClick={() => handleClick(opt.value)}
            disabled={disabled}
            aria-disabled={disabled}
            aria-pressed={isSelected}
          >
            {opt.value}
          </button>
        );
      })}
    </div>
  );
}
