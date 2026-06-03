/**
 * Phase 16 (MAP-V13-04): isViewExpired helper spec.
 *
 * Boundary semantics: Date.now() >= expiresAt is "expired"; Date.now() < expiresAt is "valid".
 * undefined entry → false (no expiry to compare); expiresAt=0 placeholder → true (markMaterializing pre-call).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { isViewExpired } from "./viewExpiry";
import type { FilterViewEntry } from "../store/filterViewStore";

const baseEntry = (overrides: Partial<FilterViewEntry> = {}): FilterViewEntry => ({
  viewName: "_kbi_filt_u1_d1_t10_sabc",
  expiresAt: Date.now() + 60_000,
  materializing: false,
  materializeVersion: 1,
  dashboardId: 1,
  ...overrides,
});

describe("isViewExpired", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false for undefined entry (no expiry to compare)", () => {
    expect(isViewExpired(undefined)).toBe(false);
  });

  it("returns false when expiresAt is in the future", () => {
    expect(isViewExpired(baseEntry({ expiresAt: Date.now() + 60_000 }))).toBe(false);
  });

  it("returns true when expiresAt is in the past", () => {
    expect(isViewExpired(baseEntry({ expiresAt: Date.now() - 1_000 }))).toBe(true);
  });

  it("returns true when expiresAt=0 (markMaterializing placeholder; no real view yet)", () => {
    expect(isViewExpired(baseEntry({ expiresAt: 0 }))).toBe(true);
  });

  it("returns true at the boundary (Date.now() === expiresAt)", () => {
    const fixed = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(fixed);
    expect(isViewExpired(baseEntry({ expiresAt: fixed }))).toBe(true);
  });
});
