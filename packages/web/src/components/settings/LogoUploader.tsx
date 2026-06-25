import { useEffect, useRef, useState } from "react";

/**
 * LogoUploader — single logo-slot component.
 *
 * Renders a file input + a preview of the active logo (either a chosen-file
 * object-URL or the stored previewUrl). The preview is rendered on a swatch
 * styled for the slot's own mode background (light surface for primary logo,
 * dark surface for dark-mode override) so contrast issues are obvious.
 *
 * Validation is server-side (Phase-81 SECA-V116-01) — the client just previews.
 * previewMode determines the swatch background via CSS class (tokens only, no hex).
 *
 * Props:
 *   label       — slot heading shown above the input (e.g. "Primary logo")
 *   previewUrl  — URL of the currently saved logo (from store / null)
 *   previewMode — "light" | "dark" — drives the preview swatch background class
 *   onFileChosen — called with the chosen File, or null to clear
 */
export interface LogoUploaderProps {
  label: string;
  previewUrl: string | null;
  previewMode: "dark" | "light";
  onFileChosen: (f: File | null) => void;
}

export function LogoUploader({ label, previewUrl, previewMode, onFileChosen }: LogoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Local object-URL preview of a chosen-but-unsaved file (revoked on change/unmount).
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  // URL.createObjectURL is unavailable under jsdom — guard so unit tests don't throw.
  const canObjectUrl = typeof URL !== "undefined" && typeof URL.createObjectURL === "function";

  useEffect(
    () => () => { if (localPreview && canObjectUrl) URL.revokeObjectURL(localPreview); },
    [localPreview, canObjectUrl],
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setLocalPreview((prev) => {
      if (prev && canObjectUrl) URL.revokeObjectURL(prev);
      return file && canObjectUrl ? URL.createObjectURL(file) : null;
    });
    onFileChosen(file);
  }

  // Chosen file (local object URL) takes precedence over the saved previewUrl.
  const shownUrl = localPreview ?? previewUrl;

  return (
    <div className="logo-uploader">
      <p className="ds-field-label">{label}</p>
      <div className={`logo-uploader-preview logo-uploader-preview--${previewMode}`}>
        {shownUrl ? (
          <img src={shownUrl} alt={label} className="logo-uploader-img" />
        ) : (
          <span className="logo-uploader-empty">No logo</span>
        )}
      </div>
      <div className="logo-uploader-actions">
        <button
          type="button"
          className="ghost-sm"
          onClick={() => inputRef.current?.click()}
        >
          Choose file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          aria-label={`Upload ${label}`}
          className="logo-uploader-input"
          onChange={handleChange}
        />
      </div>
    </div>
  );
}
