/**
 * TDD tests for the dual logo-slot Logo section (BRANDUI-06 Plan 83-04).
 *
 * Verifies:
 *   - LogoUploader renders a file input + preview area
 *   - Two LogoUploader slots render in BrandingSettingsPage (primary + dark)
 *   - Choosing a file in the dark slot marks isDirty (Save becomes enabled)
 *   - Choosing a file in the primary slot marks isDirty
 *   - handleSave calls uploadBrandLogo(file, "dark") when dark file chosen
 *   - handleSave calls uploadBrandLogo(file, "primary") when primary file chosen
 *   - Reset clears both chosen files (save does not call uploadBrandLogo after Reset)
 *   - App-name input is present, bound to appName, and drives handleDraftChange
 *
 * TDD Phase 83-04 Task 4.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { BrandConfigPayload } from "../../../api/client";

// ── Mocks must be declared before imports ────────────────────────────────────

const mockApplyBrandTokens = vi.fn();
const mockBrandStoreUpdate = vi.fn();

vi.mock("../../../store/brandStore", () => ({
  useBrandStore: Object.assign(
    (selector: (s: { config: BrandConfigPayload; logoUrl: string | null; logoDarkUrl: string | null }) => unknown) =>
      selector({ config: {}, logoUrl: null, logoDarkUrl: null }),
    {
      getState: vi.fn(() => ({
        config: {},
        logoUrl: null,
        logoDarkUrl: null,
        update: mockBrandStoreUpdate,
        revertToSaved: vi.fn(),
      })),
      subscribe: vi.fn(() => () => {}),
    }
  ),
  applyBrandTokens: (...args: unknown[]) => mockApplyBrandTokens(...args),
}));

vi.mock("../../../store/theme", () => ({
  useThemeStore: (selector: (s: { theme: string }) => unknown) =>
    selector({ theme: "dark" }),
}));

const mockUpdateBrandConfig = vi.fn();
const mockUploadBrandLogo = vi.fn();
const mockDeleteBrandLogo = vi.fn();

vi.mock("../../../api/client", async (importActual) => {
  const actual = await importActual<typeof import("../../../api/client")>();
  return {
    ...actual,
    updateBrandConfig: (...args: unknown[]) => mockUpdateBrandConfig(...args),
    uploadBrandLogo: (...args: unknown[]) => mockUploadBrandLogo(...args),
    deleteBrandLogo: (...args: unknown[]) => mockDeleteBrandLogo(...args),
  };
});

// Mock react-colorful so tests don't need canvas
vi.mock("react-colorful", () => ({
  HexColorPicker: ({ color }: { color: string }) => (
    <div data-testid="hex-picker" data-color={color} />
  ),
  HexColorInput: ({ color, onChange }: { color: string; onChange: (h: string) => void }) => (
    <input data-testid="hex-input" value={color} onChange={(e) => onChange(e.target.value)} />
  ),
}));

// Mock CodeMirror
vi.mock("@uiw/react-codemirror", () => {
  const CodeMirror = ({ value }: { value: string }) => (
    <textarea data-testid="codemirror-mock" value={value} readOnly onChange={() => {}} />
  );
  CodeMirror.displayName = "CodeMirror";
  const oneDark = {};
  return { default: CodeMirror, oneDark };
});

vi.mock("@codemirror/lang-css", () => ({ css: () => ({}) }));

vi.mock("../brandPageGuard", () => ({
  brandPageGuard: { isDirty: false, revert: null },
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import { BrandingSettingsPage } from "../BrandingSettingsPage";
import { LogoUploader } from "../LogoUploader";

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeSaveResponse(customCss = ""): { config: BrandConfigPayload; updatedAt: string } {
  return { config: { customCss }, updatedAt: new Date().toISOString() };
}

function makeFakeFile(name: string): File {
  return new File(["fake-image-bytes"], name, { type: "image/png" });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("LogoUploader component", () => {
  it("renders a file input and preview area", () => {
    const onFileChosen = vi.fn();
    render(
      <LogoUploader
        label="Primary logo"
        previewUrl={null}
        previewMode="light"
        onFileChosen={onFileChosen}
      />
    );
    // Must have a file input
    expect(screen.getByRole("button", { hidden: true }) ?? screen.getAllByRole("button")[0]).toBeDefined();
    // The label "Primary logo" must be visible
    expect(screen.getByText(/primary logo/i)).toBeDefined();
    // File input must accept images
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input?.accept).toBe("image/*");
  });

  it("calls onFileChosen when a file is selected", () => {
    const onFileChosen = vi.fn();
    render(
      <LogoUploader
        label="Dark-mode override"
        previewUrl={null}
        previewMode="dark"
        onFileChosen={onFileChosen}
      />
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const fakeFile = makeFakeFile("dark.png");
    Object.defineProperty(input, "files", { value: [fakeFile], configurable: true });
    fireEvent.change(input);
    expect(onFileChosen).toHaveBeenCalledWith(fakeFile);
  });

  it("renders previewUrl as an img src when provided", () => {
    const onFileChosen = vi.fn();
    render(
      <LogoUploader
        label="Primary logo"
        previewUrl="/api/branding/logo?v=123"
        previewMode="light"
        onFileChosen={onFileChosen}
      />
    );
    const img = document.querySelector("img") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.src).toContain("/api/branding/logo");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("BrandingSettingsPage — dual logo slots (BRANDUI-06)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders two LogoUploader slots in the Logo section", () => {
    render(<BrandingSettingsPage />);
    // Primary slot: find by aria-label on the file input
    const primaryInput = document.querySelector('input[aria-label="Upload Primary logo"]');
    expect(primaryInput).not.toBeNull();
    // Dark slot: find by aria-label on the file input
    const darkInput = document.querySelector('input[aria-label="Upload Dark-mode override (optional)"]');
    expect(darkInput).not.toBeNull();
    // Both file inputs exist
    const inputs = document.querySelectorAll('input[type="file"]');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });

  it("renders the app-name text input in the Logo section", () => {
    render(<BrandingSettingsPage />);
    const appNameInput = screen.getByRole("textbox", { name: /app name/i });
    expect(appNameInput).toBeDefined();
  });

  it("choosing a file in the dark slot marks isDirty (Save becomes enabled)", () => {
    render(<BrandingSettingsPage />);
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).toBeDisabled();

    // Find the dark-slot file input (second file input on the page)
    const inputs = document.querySelectorAll('input[type="file"]');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    const darkInput = inputs[1] as HTMLInputElement;
    const fakeFile = makeFakeFile("dark.png");
    Object.defineProperty(darkInput, "files", { value: [fakeFile], configurable: true });
    fireEvent.change(darkInput);

    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
  });

  it("choosing a file in the primary slot marks isDirty (Save becomes enabled)", () => {
    render(<BrandingSettingsPage />);
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).toBeDisabled();

    const inputs = document.querySelectorAll('input[type="file"]');
    const primaryInput = inputs[0] as HTMLInputElement;
    const fakeFile = makeFakeFile("primary.png");
    Object.defineProperty(primaryInput, "files", { value: [fakeFile], configurable: true });
    fireEvent.change(primaryInput);

    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
  });

  it("handleSave calls uploadBrandLogo(file, 'dark') when dark file was chosen", async () => {
    mockUpdateBrandConfig.mockResolvedValue(makeSaveResponse());
    mockUploadBrandLogo.mockResolvedValue({ logoDarkUrl: "/api/branding/logo?variant=dark&v=ts" });
    mockBrandStoreUpdate.mockImplementation(() => {});

    render(<BrandingSettingsPage />);

    // Choose a dark logo file
    const inputs = document.querySelectorAll('input[type="file"]');
    const darkInput = inputs[1] as HTMLInputElement;
    const fakeFile = makeFakeFile("dark-logo.png");
    Object.defineProperty(darkInput, "files", { value: [fakeFile], configurable: true });
    fireEvent.change(darkInput);

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockUploadBrandLogo).toHaveBeenCalledWith(fakeFile, "dark");
    });
  });

  it("handleSave calls uploadBrandLogo(file, 'primary') when primary file was chosen", async () => {
    mockUpdateBrandConfig.mockResolvedValue(makeSaveResponse());
    mockUploadBrandLogo.mockResolvedValue({ logoUrl: "/api/branding/logo?v=ts" });
    mockBrandStoreUpdate.mockImplementation(() => {});

    render(<BrandingSettingsPage />);

    const inputs = document.querySelectorAll('input[type="file"]');
    const primaryInput = inputs[0] as HTMLInputElement;
    const fakeFile = makeFakeFile("primary-logo.png");
    Object.defineProperty(primaryInput, "files", { value: [fakeFile], configurable: true });
    fireEvent.change(primaryInput);

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockUploadBrandLogo).toHaveBeenCalledWith(fakeFile, "primary");
    });
  });

  it("Reset clears chosen files AND removes saved logos on Save (deleteBrandLogo, not uploadBrandLogo)", async () => {
    mockUpdateBrandConfig.mockResolvedValue(makeSaveResponse());
    mockBrandStoreUpdate.mockImplementation(() => {});
    mockDeleteBrandLogo.mockResolvedValue(undefined);

    render(<BrandingSettingsPage />);

    // Choose both files
    const inputs = document.querySelectorAll('input[type="file"]');
    const primaryInput = inputs[0] as HTMLInputElement;
    const darkInput = inputs[1] as HTMLInputElement;
    Object.defineProperty(primaryInput, "files", { value: [makeFakeFile("p.png")], configurable: true });
    fireEvent.change(primaryInput);
    Object.defineProperty(darkInput, "files", { value: [makeFakeFile("d.png")], configurable: true });
    fireEvent.change(darkInput);

    // Reset → stages removal of both logos and clears the chosen files
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));

    // Now save
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockUpdateBrandConfig).toHaveBeenCalledTimes(1);
    });
    // After Reset, chosen files were cleared → no upload; instead both logos are deleted.
    expect(mockUploadBrandLogo).not.toHaveBeenCalled();
    expect(mockDeleteBrandLogo).toHaveBeenCalledWith("primary");
    expect(mockDeleteBrandLogo).toHaveBeenCalledWith("dark");
  });

  it("app-name input change marks isDirty and drives draft.appName", () => {
    render(<BrandingSettingsPage />);
    const appNameInput = screen.getByRole("textbox", { name: /app name/i });
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();

    fireEvent.change(appNameInput, { target: { value: "Acme Corp" } });
    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
  });
});
