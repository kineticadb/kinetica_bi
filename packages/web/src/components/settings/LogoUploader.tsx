import { useRef } from "react";

/**
 * LogoUploader — single logo-slot component. PRESENTATIONAL: the parent owns all
 * preview state (single source of truth) and passes the resolved previewUrl —
 * whether that's a chosen-file object URL, the saved URL, or null (staged removal).
 * This avoids a second source of truth that survives Reset (a child-local preview
 * would keep showing a chosen file after the parent staged its removal).
 *
 * The preview renders on a swatch styled for the slot's own mode background so
 * contrast issues are obvious. Validation is server-side (Phase-81 SECA-V116-01).
 *
 * Props:
 *   label       — slot heading shown above the input (e.g. "Primary logo")
 *   previewUrl  — resolved preview URL (parent-owned), or null → "No logo"
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

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onFileChosen(e.target.files?.[0] ?? null);
  }

  return (
    <div className="logo-uploader">
      <p className="ds-field-label">{label}</p>
      <div className={`logo-uploader-preview logo-uploader-preview--${previewMode}`}>
        {previewUrl ? (
          <img src={previewUrl} alt={label} className="logo-uploader-img" />
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
