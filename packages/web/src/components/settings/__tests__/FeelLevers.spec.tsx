/**
 * RED tests for FeelLevers.tsx — verifies that each control group dispatches
 * the correct field + value to onChange.
 *
 * TDD Phase 83-03 Task 1.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FeelLevers } from "../FeelLevers";
import type { BrandConfigPayload } from "../../../api/client";

const EMPTY_DRAFT: BrandConfigPayload = {};

describe("FeelLevers", () => {
  it("clicking Comfortable dispatches densityPreset: 'comfortable'", () => {
    const onChange = vi.fn();
    render(<FeelLevers draft={EMPTY_DRAFT} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /comfortable/i }));
    expect(onChange).toHaveBeenCalledWith({ densityPreset: "comfortable" });
  });

  it("clicking Compact dispatches densityPreset: 'compact'", () => {
    const onChange = vi.fn();
    render(<FeelLevers draft={EMPTY_DRAFT} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^compact$/i }));
    expect(onChange).toHaveBeenCalledWith({ densityPreset: "compact" });
  });

  it("clicking Spacious dispatches densityPreset: 'spacious'", () => {
    const onChange = vi.fn();
    render(<FeelLevers draft={EMPTY_DRAFT} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /spacious/i }));
    expect(onChange).toHaveBeenCalledWith({ densityPreset: "spacious" });
  });

  it("toggling glow Off dispatches glowEnabled: false", () => {
    const onChange = vi.fn();
    render(<FeelLevers draft={EMPTY_DRAFT} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^off$/i }));
    expect(onChange).toHaveBeenCalledWith({ glowEnabled: false });
  });

  it("toggling glow On dispatches glowEnabled: true", () => {
    const onChange = vi.fn();
    // Start with glow off
    render(<FeelLevers draft={{ ...EMPTY_DRAFT, glowEnabled: false }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^on$/i }));
    expect(onChange).toHaveBeenCalledWith({ glowEnabled: true });
  });

  it("selecting Large type scale dispatches typeScaleBase: 14", () => {
    const onChange = vi.fn();
    render(<FeelLevers draft={EMPTY_DRAFT} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^large$/i }));
    expect(onChange).toHaveBeenCalledWith({ typeScaleBase: 14 });
  });

  it("selecting Small type scale dispatches typeScaleBase: 11", () => {
    const onChange = vi.fn();
    render(<FeelLevers draft={EMPTY_DRAFT} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^small$/i }));
    expect(onChange).toHaveBeenCalledWith({ typeScaleBase: 11 });
  });

  it("selecting Medium type scale dispatches typeScaleBase: 12", () => {
    const onChange = vi.fn();
    render(<FeelLevers draft={EMPTY_DRAFT} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^medium$/i }));
    expect(onChange).toHaveBeenCalledWith({ typeScaleBase: 12 });
  });

  it("clicking radius Sharp dispatches radiusPreset: 'sharp'", () => {
    const onChange = vi.fn();
    render(<FeelLevers draft={EMPTY_DRAFT} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^sharp$/i }));
    expect(onChange).toHaveBeenCalledWith({ radiusPreset: "sharp" });
  });

  it("clicking motion None dispatches motionSpeed: 'none'", () => {
    const onChange = vi.fn();
    render(<FeelLevers draft={EMPTY_DRAFT} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^none$/i }));
    expect(onChange).toHaveBeenCalledWith({ motionSpeed: "none" });
  });

  it("clicking motion Fast dispatches motionSpeed: 'fast'", () => {
    const onChange = vi.fn();
    render(<FeelLevers draft={EMPTY_DRAFT} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^fast$/i }));
    expect(onChange).toHaveBeenCalledWith({ motionSpeed: "fast" });
  });

  it("active density button gets feel-seg-active class", () => {
    render(<FeelLevers draft={{ densityPreset: "comfortable" }} onChange={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /comfortable/i });
    expect(btn.className).toContain("feel-seg-active");
  });

  it("renders all 5 control groups", () => {
    render(<FeelLevers draft={EMPTY_DRAFT} onChange={vi.fn()} />);
    expect(screen.getByText(/density/i)).toBeInTheDocument();
    expect(screen.getByText(/radius/i)).toBeInTheDocument();
    expect(screen.getByText(/glow/i)).toBeInTheDocument();
    expect(screen.getByText(/type scale/i)).toBeInTheDocument();
    expect(screen.getByText(/motion/i)).toBeInTheDocument();
  });
});
