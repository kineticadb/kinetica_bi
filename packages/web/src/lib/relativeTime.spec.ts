import { describe, it, expect } from "vitest";
import { humanizeRelativeTime } from "./relativeTime";

describe("humanizeRelativeTime", () => {
  it('returns "never" for null input', () => {
    expect(humanizeRelativeTime(null)).toBe("never");
  });

  it("returns minutes ago for a timestamp ~5 minutes in the past", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(humanizeRelativeTime(fiveMinutesAgo)).toMatch(/\d+m ago/);
  });

  it("returns hours ago for a timestamp ~2 hours in the past", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(humanizeRelativeTime(twoHoursAgo)).toMatch(/\d+h ago/);
  });

  it("returns days ago for a timestamp ~3 days in the past", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(humanizeRelativeTime(threeDaysAgo)).toMatch(/\d+d ago/);
  });

  it("marker-less UTC string from 5 min ago renders positive minutes (not negative)", () => {
    // Server emits "YYYY-MM-DD HH:MM:SS" without timezone marker — must be treated as UTC
    const d = new Date(Date.now() - 5 * 60 * 1000);
    const utc = d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
    expect(humanizeRelativeTime(utc)).toMatch(/\d+m ago/);
  });

  it("future marker-less UTC timestamp (clock skew) renders 'just now' (not negative)", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const utc = future.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
    expect(humanizeRelativeTime(utc)).toBe("just now");
  });
});
