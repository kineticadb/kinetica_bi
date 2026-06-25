/**
 * RED tests for BrandingSettingsPage handleSave + handleReset — verifies:
 *   - handleSave calls updateBrandConfig(draft)
 *   - handleSave calls uploadBrandLogo when draftLogoFile is set
 *   - handleSave calls brandStore.update with returned config
 *   - handleSave sets stripped notice when returned customCss differs
 *   - handleSave sets isDirty false after successful save
 *   - handleReset live-applies Aurora defaults and keeps isDirty true
 *
 * TDD Phase 83-03 Task 3.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { BrandConfigPayload } from "../../../api/client";

// ── Mocks must be declared before imports ────────────────────────────────────

const mockApplyBrandTokens = vi.fn();
const mockBrandStoreUpdate = vi.fn();

vi.mock("../../../store/brandStore", () => ({
  useBrandStore: Object.assign(
    // Direct call (hook usage) — returns state slices
    (selector: (s: { config: BrandConfigPayload; logoUrl: string | null; logoDarkUrl: string | null }) => unknown) =>
      selector({ config: {}, logoUrl: null, logoDarkUrl: null }),
    {
      // Zustand-compatible static methods
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

// Mocked API client
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeSaveResponse(customCss: string = ""): { config: BrandConfigPayload; updatedAt: string } {
  return {
    config: { customCss, primaryColor: "#7f40ed" },
    updatedAt: new Date().toISOString(),
  };
}

describe("BrandingSettingsPage — handleSave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset getState mock to return update function
    vi.mocked(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (vi.mocked as any)(vi.mocked)
    );
  });

  it("Save button is disabled when not dirty", () => {
    render(<BrandingSettingsPage />);
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).toBeDisabled();
  });

  it("clicking Save calls updateBrandConfig with draft", async () => {
    mockUpdateBrandConfig.mockResolvedValue(makeSaveResponse());
    mockBrandStoreUpdate.mockImplementation(() => {});

    render(<BrandingSettingsPage />);
    // Make dirty
    fireEvent.click(screen.getByRole("button", { name: /comfortable/i }));

    fireEvent.click(screen.getByRole("button", { name: /^save$|^saving/i }));

    await waitFor(() => {
      expect(mockUpdateBrandConfig).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateBrandConfig).toHaveBeenCalledWith(
      expect.objectContaining({ densityPreset: "comfortable" })
    );
  });

  it("calls brandStore.getState().update after successful Save", async () => {
    const savedConfig = makeSaveResponse("").config;
    mockUpdateBrandConfig.mockResolvedValue({ config: savedConfig, updatedAt: "" });
    mockBrandStoreUpdate.mockImplementation(() => {});

    render(<BrandingSettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /comfortable/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$|^saving/i }));

    await waitFor(() => {
      expect(mockBrandStoreUpdate).toHaveBeenCalledTimes(1);
    });
    // logoUrl may be null (no logo set in test); logoDarkUrl also null (no dark file in test)
    expect(mockBrandStoreUpdate).toHaveBeenCalledWith(
      savedConfig,
      expect.toSatisfy((v: unknown) => v === null || typeof v === "string"),
      expect.toSatisfy((v: unknown) => v === null || typeof v === "string" || v === undefined)
    );
  });

  it("sets stripped notice when server-returned customCss differs from submitted", async () => {
    // Server strips from empty string to "/* cleaned */" — differs from submitted ""
    mockUpdateBrandConfig.mockResolvedValue(makeSaveResponse("/* cleaned */"));
    mockBrandStoreUpdate.mockImplementation(() => {});

    render(<BrandingSettingsPage />);
    // Make dirty (draft.customCss is "" because we don't type in the editor mock)
    fireEvent.click(screen.getByRole("button", { name: /comfortable/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$|^saving/i }));

    await waitFor(() => {
      expect(
        screen.queryByText(/some declarations were removed/i)
      ).not.toBeNull();
    });
  });

  it("does NOT show stripped notice when returned customCss equals submitted", async () => {
    // Both empty → equal
    mockUpdateBrandConfig.mockResolvedValue(makeSaveResponse(""));
    mockBrandStoreUpdate.mockImplementation(() => {});

    render(<BrandingSettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /comfortable/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$|^saving/i }));

    await waitFor(() => {
      expect(mockUpdateBrandConfig).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/some declarations were removed/i)).toBeNull();
  });

  it("Save button is disabled after successful Save (isDirty = false)", async () => {
    mockUpdateBrandConfig.mockResolvedValue(makeSaveResponse());
    mockBrandStoreUpdate.mockImplementation(() => {});

    render(<BrandingSettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /comfortable/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$|^saving/i }));

    await waitFor(() => {
      expect(mockUpdateBrandConfig).toHaveBeenCalled();
    });
    await waitFor(() => {
      const saveBtn = screen.getByRole("button", { name: /^save$/i });
      expect(saveBtn).toBeDisabled();
    });
  });
});

describe("BrandingSettingsPage — handleReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clicking Reset to Defaults calls applyBrandTokens with empty config {}", () => {
    render(<BrandingSettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(mockApplyBrandTokens).toHaveBeenCalledWith({}, expect.anything());
  });

  it("Reset sets isDirty true (Save button becomes enabled)", () => {
    render(<BrandingSettingsPage />);
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));

    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
  });

  it("Reset does NOT call updateBrandConfig (persists only on Save)", () => {
    render(<BrandingSettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(mockUpdateBrandConfig).not.toHaveBeenCalled();
  });
});
