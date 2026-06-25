/**
 * FeelLevers — five coarse feel-control groups for the Branding settings page.
 *
 * Controls:
 *   - Density: Compact / Comfortable / Spacious → densityPreset
 *   - Radius:  Sharp / Default / Round → radiusPreset
 *   - Glow:    On / Off → glowEnabled
 *   - Type Scale: Small / Medium / Large → typeScaleBase (11 / 12 / 14)
 *   - Motion:  None / Reduced / Default / Fast → motionSpeed
 *
 * Each control calls onChange with only the changed field so the parent can merge
 * it into the draft via handleDraftChange, which live-applies via applyBrandTokens.
 *
 * Aurora defaults (null/undefined values):
 *   densityPreset → compact, radiusPreset → default, glowEnabled → true (on),
 *   typeScaleBase → 12 (Medium), motionSpeed → default
 *
 * No hex literals — uses only CSS tokens + ds-* + feel-seg* classes.
 */
import type { BrandConfigPayload } from "../../api/client";

interface Props {
  draft: BrandConfigPayload;
  onChange: (updates: Partial<BrandConfigPayload>) => void;
}

/** Small segmented-control group: label + N buttons. */
function SegGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: T }[];
  value: T | null | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <div className="feel-group">
      <span className="ds-field-label">{label}</span>
      <div className="feel-seg">
        {options.map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            className={`feel-seg-btn${value === opt.value ? " feel-seg-active" : ""}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FeelLevers({ draft, onChange }: Props) {
  const density = draft.densityPreset ?? "compact";
  const radius = draft.radiusPreset ?? "default";
  // glowEnabled null/undefined = on (Aurora default)
  const glow: boolean = draft.glowEnabled !== false;
  const typeScale = draft.typeScaleBase ?? 12;
  const motion = draft.motionSpeed ?? "default";

  return (
    <div className="feel-levers">
      {/* Density */}
      <SegGroup
        label="Density"
        options={[
          { label: "Compact", value: "compact" },
          { label: "Comfortable", value: "comfortable" },
          { label: "Spacious", value: "spacious" },
        ] as { label: string; value: "compact" | "comfortable" | "spacious" }[]}
        value={density}
        onChange={(v) => onChange({ densityPreset: v as "compact" | "comfortable" | "spacious" })}
      />

      {/* Radius */}
      <SegGroup
        label="Radius"
        options={[
          { label: "Sharp", value: "sharp" },
          { label: "Default", value: "default" },
          { label: "Round", value: "round" },
        ] as { label: string; value: "sharp" | "default" | "round" }[]}
        value={radius}
        onChange={(v) => onChange({ radiusPreset: v as "sharp" | "default" | "round" })}
      />

      {/* Glow */}
      <div className="feel-group">
        <span className="ds-field-label">Glow</span>
        <div className="feel-seg">
          <button
            type="button"
            className={`feel-seg-btn${glow ? " feel-seg-active" : ""}`}
            onClick={() => onChange({ glowEnabled: true })}
          >
            On
          </button>
          <button
            type="button"
            className={`feel-seg-btn${!glow ? " feel-seg-active" : ""}`}
            onClick={() => onChange({ glowEnabled: false })}
          >
            Off
          </button>
        </div>
      </div>

      {/* Type Scale */}
      <SegGroup
        label="Type Scale"
        options={[
          { label: "Small", value: 11 },
          { label: "Medium", value: 12 },
          { label: "Large", value: 14 },
        ] as { label: string; value: 11 | 12 | 14 }[]}
        value={typeScale}
        onChange={(v) => onChange({ typeScaleBase: v as 11 | 12 | 14 })}
      />

      {/* Motion */}
      <SegGroup
        label="Motion"
        options={[
          { label: "None", value: "none" },
          { label: "Reduced", value: "reduced" },
          { label: "Default", value: "default" },
          { label: "Fast", value: "fast" },
        ] as { label: string; value: "none" | "reduced" | "default" | "fast" }[]}
        value={motion}
        onChange={(v) => onChange({ motionSpeed: v as "none" | "reduced" | "default" | "fast" })}
      />
    </div>
  );
}
