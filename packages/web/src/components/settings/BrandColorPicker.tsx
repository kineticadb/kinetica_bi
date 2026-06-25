import { HexColorPicker } from "react-colorful";

interface BrandColorPickerProps {
  label: string;
  /** Current draft color value (hex string). May be undefined/null if no override set. */
  value: string | null | undefined;
  /** Aurora default hex for this token — used when value is not set. */
  fallback: string;
  onChange: (hex: string) => void;
}

/**
 * Labeled react-colorful HexColorPicker for a single brand color token.
 * Passes hex value through to the parent's handleDraftChange path.
 * The fallback prop carries the Aurora default hex literal (authored in the parent
 * COLOR_FIELDS map which is on the theme-guard ALLOWLIST).
 */
export function BrandColorPicker({ label, value, fallback, onChange }: BrandColorPickerProps) {
  const current = value || fallback;
  return (
    <div className="brand-color-picker">
      <label className="ds-field-label">{label}</label>
      <HexColorPicker color={current} onChange={onChange} />
      <span className="brand-color-hex">{current}</span>
    </div>
  );
}
