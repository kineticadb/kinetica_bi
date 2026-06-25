import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrandingSettingsPage } from "../BrandingSettingsPage";

// Mock brandStore so page loads without real store
vi.mock("../../../store/brandStore", () => ({
  useBrandStore: {
    getState: vi.fn(() => ({ config: {}, logoUrl: null, revertToSaved: vi.fn() })),
    subscribe: vi.fn(() => () => {}),
  },
  applyBrandTokens: vi.fn(),
}));

// Mock theme store
vi.mock("../../../store/theme", () => ({
  useThemeStore: (selector: (s: { theme: string }) => unknown) =>
    selector({ theme: "dark" }),
}));

// Mock API client
vi.mock("../../../api/client", () => ({
  updateBrandConfig: vi.fn(),
  uploadBrandLogo: vi.fn(),
}));

// Mock brandPageGuard
vi.mock("../brandPageGuard", () => ({
  brandPageGuard: { isDirty: false, revert: null },
}));

describe("BrandingSettingsPage — Colors section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders exactly 18 color pickers (9 dark + 9 light)", () => {
    render(<BrandingSettingsPage />);
    // Each BrandColorPicker renders a .brand-color-picker div
    const pickers = document.querySelectorAll(".brand-color-picker");
    expect(pickers).toHaveLength(18);
  });

  it("renders a Dark column header and a Light column header", () => {
    render(<BrandingSettingsPage />);
    expect(screen.getByText("Dark")).toBeTruthy();
    expect(screen.getByText("Light")).toBeTruthy();
  });

  it("renders a text/bg WcagBadge in the dark column", () => {
    render(<BrandingSettingsPage />);
    // WCAG badges contain ratio text like "14.3:1 AA" or "FAIL"
    // The dark text/bg badge should render somewhere in the colors section
    const colorSection = document.querySelector("#brand-colors");
    expect(colorSection).toBeTruthy();
    // Both dark + light badges present: look for at least 6 badges (3 pairs × 2 columns)
    const badges = colorSection!.querySelectorAll(".wcag-pass, .wcag-fail");
    expect(badges.length).toBeGreaterThanOrEqual(6);
  });

  it("renders WCAG badges in BOTH dark and light columns", () => {
    render(<BrandingSettingsPage />);
    const columns = document.querySelectorAll(".brand-color-columns > div");
    // Two columns
    expect(columns).toHaveLength(2);
    // Each column has at least one badge
    const darkBadges = columns[0].querySelectorAll(".wcag-pass, .wcag-fail");
    const lightBadges = columns[1].querySelectorAll(".wcag-pass, .wcag-fail");
    expect(darkBadges.length).toBeGreaterThanOrEqual(1);
    expect(lightBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("renders an active-theme note", () => {
    render(<BrandingSettingsPage />);
    const note = document.querySelector(".brand-theme-note");
    expect(note).toBeTruthy();
  });
});
