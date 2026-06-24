import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock BroadcastChannel BEFORE importing brandStore (module-level channel is created on import).
const mockPostMessage = vi.fn();
const mockAddEventListener = vi.fn();
vi.stubGlobal("BroadcastChannel", vi.fn().mockImplementation(() => ({
  addEventListener: mockAddEventListener,
  postMessage: mockPostMessage,
  close: vi.fn(),
})));

// Mock fetchBranding before brandStore import so it's available at module evaluation.
vi.mock("../api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/client")>();
  return {
    ...original,
    fetchBranding: vi.fn(),
  };
});

import { fetchBranding } from "../api/client";
import { useBrandStore, BRAND_STORAGE_KEY } from "./brandStore";
import { useThemeStore } from "./theme";

const mockFetchBranding = fetchBranding as ReturnType<typeof vi.fn>;

// Helper to reset CSS custom properties before each test.
function clearTokens() {
  const root = document.documentElement;
  const props = ["--accent", "--accent-2", "--bg", "--panel", "--text", "--muted", "--border", "--danger", "--font-body"];
  for (const p of props) root.style.removeProperty(p);
}

describe("useBrandStore — applyBrandTokens", () => {
  beforeEach(() => {
    clearTokens();
    localStorage.clear();
    mockPostMessage.mockClear();
    mockAddEventListener.mockClear();
    // Reset to known state
    useBrandStore.setState({
      config: null,
      appName: null,
      logoUrl: null,
      customCss: null,
      hasLoaded: false,
    });
    useThemeStore.getState().setTheme("dark");
    mockFetchBranding.mockReset();
  });

  afterEach(() => {
    clearTokens();
  });

  it("applyBrandTokens in dark mode sets --accent from primaryColor", async () => {
    mockFetchBranding.mockResolvedValue({
      config: { primaryColor: "#ff0000" },
      logoUrl: null,
      updatedAt: null,
    });
    useThemeStore.getState().setTheme("dark");
    await useBrandStore.getState().bootstrap();
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#ff0000");
  });

  it("applyBrandTokens in light mode sets --accent from lightPrimaryColor", async () => {
    mockFetchBranding.mockResolvedValue({
      config: { primaryColor: "#ff0000", lightPrimaryColor: "#00ff00" },
      logoUrl: null,
      updatedAt: null,
    });
    useThemeStore.getState().setTheme("light");
    await useBrandStore.getState().bootstrap();
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#00ff00");
  });

  it("applyBrandTokens in light mode falls back to primaryColor when lightPrimaryColor is absent", async () => {
    mockFetchBranding.mockResolvedValue({
      config: { primaryColor: "#ff0000" },
      logoUrl: null,
      updatedAt: null,
    });
    useThemeStore.getState().setTheme("light");
    await useBrandStore.getState().bootstrap();
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#ff0000");
  });

  it("applyBrandTokens calls removeProperty when primaryColor is null", async () => {
    // First set a value
    document.documentElement.style.setProperty("--accent", "#stale");
    mockFetchBranding.mockResolvedValue({
      config: { primaryColor: null },
      logoUrl: null,
      updatedAt: null,
    });
    useThemeStore.getState().setTheme("dark");
    await useBrandStore.getState().bootstrap();
    // removeProperty should have cleared the stale value
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("");
  });

  it("applyBrandTokens sets --font-body (NOT --font-family) from fontFamily", async () => {
    mockFetchBranding.mockResolvedValue({
      config: { fontFamily: "Inter, sans-serif" },
      logoUrl: null,
      updatedAt: null,
    });
    await useBrandStore.getState().bootstrap();
    expect(document.documentElement.style.getPropertyValue("--font-body")).toBe("Inter, sans-serif");
    // --font-family must NOT be set
    expect(document.documentElement.style.getPropertyValue("--font-family")).toBe("");
  });

  it("applyBrandTokens with null config does not throw", async () => {
    mockFetchBranding.mockResolvedValue({
      config: {},
      logoUrl: null,
      updatedAt: null,
    });
    expect(async () => {
      await useBrandStore.getState().bootstrap();
    }).not.toThrow();
  });
});

describe("useBrandStore — bootstrap()", () => {
  beforeEach(() => {
    clearTokens();
    localStorage.clear();
    mockPostMessage.mockClear();
    useBrandStore.setState({
      config: null,
      appName: null,
      logoUrl: null,
      customCss: null,
      hasLoaded: false,
    });
    useThemeStore.getState().setTheme("dark");
    mockFetchBranding.mockReset();
  });

  afterEach(() => {
    clearTokens();
  });

  it("bootstrap() writes kbi-brand-tokens to localStorage with config + logoUrl", async () => {
    mockFetchBranding.mockResolvedValue({
      config: { primaryColor: "#aabbcc", appName: "TestApp" },
      logoUrl: "/api/branding/logo?v=123",
      updatedAt: "2026-01-01",
    });
    await useBrandStore.getState().bootstrap();
    const raw = localStorage.getItem(BRAND_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.primaryColor).toBe("#aabbcc");
    expect(parsed.logoUrl).toBe("/api/branding/logo?v=123");
  });

  it("bootstrap() sets document.title to appName", async () => {
    mockFetchBranding.mockResolvedValue({
      config: { appName: "MyBrand" },
      logoUrl: null,
      updatedAt: null,
    });
    await useBrandStore.getState().bootstrap();
    expect(document.title).toBe("MyBrand");
  });

  it("bootstrap() sets document.title to 'Kinetica BI' when appName is null", async () => {
    mockFetchBranding.mockResolvedValue({
      config: { appName: null },
      logoUrl: null,
      updatedAt: null,
    });
    await useBrandStore.getState().bootstrap();
    expect(document.title).toBe("Kinetica BI");
  });

  it("bootstrap() populates state: config, appName, logoUrl, customCss, hasLoaded=true", async () => {
    mockFetchBranding.mockResolvedValue({
      config: { appName: "TestApp", customCss: ".x { color: red; }" },
      logoUrl: "/api/branding/logo?v=42",
      updatedAt: null,
    });
    await useBrandStore.getState().bootstrap();
    const state = useBrandStore.getState();
    expect(state.appName).toBe("TestApp");
    expect(state.logoUrl).toBe("/api/branding/logo?v=42");
    expect(state.customCss).toBe(".x { color: red; }");
    expect(state.hasLoaded).toBe(true);
    expect(state.config).toEqual({ appName: "TestApp", customCss: ".x { color: red; }" });
  });

  it("bootstrap() does not throw when fetchBranding rejects (network failure)", async () => {
    mockFetchBranding.mockRejectedValue(new Error("Network error"));
    await expect(useBrandStore.getState().bootstrap()).resolves.not.toThrow();
  });

  it("bootstrap() does NOT call notifyOtherTabs (BroadcastChannel.postMessage)", async () => {
    mockFetchBranding.mockResolvedValue({
      config: {},
      logoUrl: null,
      updatedAt: null,
    });
    mockPostMessage.mockClear();
    await useBrandStore.getState().bootstrap();
    expect(mockPostMessage).not.toHaveBeenCalled();
  });
});

describe("useBrandStore — update()", () => {
  beforeEach(() => {
    clearTokens();
    localStorage.clear();
    mockPostMessage.mockClear();
    useBrandStore.setState({
      config: null,
      appName: null,
      logoUrl: null,
      customCss: null,
      hasLoaded: false,
    });
    useThemeStore.getState().setTheme("dark");
    mockFetchBranding.mockReset();
  });

  afterEach(() => {
    clearTokens();
  });

  it("update() re-applies tokens to :root", () => {
    useBrandStore.getState().update({ primaryColor: "#123456" }, null);
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#123456");
  });

  it("update() sets document.title", () => {
    useBrandStore.getState().update({ appName: "UpdatedApp" }, null);
    expect(document.title).toBe("UpdatedApp");
  });

  it("update() writes localStorage with config keys + logoUrl", () => {
    useBrandStore.getState().update(
      { primaryColor: "#abcdef", appName: "Foo" },
      "/api/branding/logo?v=99"
    );
    const raw = localStorage.getItem(BRAND_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.primaryColor).toBe("#abcdef");
    expect(parsed.logoUrl).toBe("/api/branding/logo?v=99");
  });

  it("update() calls BroadcastChannel.postMessage (notifyOtherTabs)", () => {
    mockPostMessage.mockClear();
    useBrandStore.getState().update({ primaryColor: "#aabbcc" }, null);
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
  });

  it("update() updates zustand state", () => {
    useBrandStore.getState().update(
      { appName: "UpdatedBrand", customCss: ".y{}" },
      "/logo.png"
    );
    const state = useBrandStore.getState();
    expect(state.appName).toBe("UpdatedBrand");
    expect(state.logoUrl).toBe("/logo.png");
    expect(state.customCss).toBe(".y{}");
  });
});

describe("useBrandStore — theme subscription", () => {
  beforeEach(() => {
    clearTokens();
    localStorage.clear();
    mockPostMessage.mockClear();
    useBrandStore.setState({
      config: null,
      appName: null,
      logoUrl: null,
      customCss: null,
      hasLoaded: false,
    });
    useThemeStore.getState().setTheme("dark");
    mockFetchBranding.mockReset();
  });

  afterEach(() => {
    clearTokens();
    useThemeStore.getState().setTheme("dark");
  });

  it("toggling theme to light re-applies lightPrimaryColor to --accent", async () => {
    mockFetchBranding.mockResolvedValue({
      config: { primaryColor: "#dark111", lightPrimaryColor: "#light222" },
      logoUrl: null,
      updatedAt: null,
    });
    useThemeStore.getState().setTheme("dark");
    await useBrandStore.getState().bootstrap();
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#dark111");

    // Switch to light — subscription should re-apply
    useThemeStore.getState().setTheme("light");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#light222");
  });

  it("toggling back to dark re-applies primaryColor to --accent", async () => {
    mockFetchBranding.mockResolvedValue({
      config: { primaryColor: "#dark111", lightPrimaryColor: "#light222" },
      logoUrl: null,
      updatedAt: null,
    });
    useThemeStore.getState().setTheme("dark");
    await useBrandStore.getState().bootstrap();
    useThemeStore.getState().setTheme("light");
    useThemeStore.getState().setTheme("dark");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#dark111");
  });
});
