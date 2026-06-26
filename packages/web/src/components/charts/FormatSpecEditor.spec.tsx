/**
 * FormatSpecEditor spec — Phase 86 Plan 01
 *
 * Coverage:
 *   T1 — with spec={null}, the select value is "" (Use column default) and no per-kind controls render
 *   T2 — selecting "si" fires onChange with { kind: "si", decimals: 1 } (default)
 *   T3 — with an si spec, editing decimals fires onChange with the new decimals value
 *   T4 — selecting "— Use column default —" (value "") fires onChange(null)
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { FormatSpecEditor } from "./FormatSpecEditor";
import type { FormatSpec } from "../../lib/columnFormatter";

describe("FormatSpecEditor", () => {
  // ---------------------------------------------------------------------------
  // T1: with spec={null}, the select shows "" and no per-kind controls render
  // ---------------------------------------------------------------------------
  it("T1: with spec=null, the kind select value is '' and no controls render", () => {
    const onChange = vi.fn();
    render(<FormatSpecEditor spec={null} onChange={onChange} />);

    const kindSelect = screen.getByRole("combobox", { name: /format kind/i }) as HTMLSelectElement;
    expect(kindSelect.value).toBe("");

    // No per-kind controls should render
    expect(screen.queryByRole("spinbutton", { name: /decimal places/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /date preset/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /d3 specifier/i })).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // T2: selecting "si" fires onChange with { kind: "si", decimals: 1 }
  // ---------------------------------------------------------------------------
  it("T2: selecting 'si' fires onChange with default SI spec", () => {
    const onChange = vi.fn();
    render(<FormatSpecEditor spec={null} onChange={onChange} />);

    const kindSelect = screen.getByRole("combobox", { name: /format kind/i });
    fireEvent.change(kindSelect, { target: { value: "si" } });

    expect(onChange).toHaveBeenCalledWith({ kind: "si", decimals: 1 });
  });

  // ---------------------------------------------------------------------------
  // T3: with an si spec, editing decimals fires onChange with the new decimals value
  // ---------------------------------------------------------------------------
  it("T3: with SI spec, editing decimals fires onChange with updated decimals", () => {
    const onChange = vi.fn();
    const spec: FormatSpec = { kind: "si", decimals: 1 };
    render(<FormatSpecEditor spec={spec} onChange={onChange} />);

    const decimalsInput = screen.getByRole("spinbutton", { name: /decimal places/i });
    fireEvent.change(decimalsInput, { target: { value: "3" } });

    expect(onChange).toHaveBeenCalledWith({ kind: "si", decimals: 3 });
  });

  // ---------------------------------------------------------------------------
  // T4: selecting "— Use column default —" (value "") fires onChange(null)
  // ---------------------------------------------------------------------------
  it("T4: selecting the empty option fires onChange(null)", () => {
    const onChange = vi.fn();
    const spec: FormatSpec = { kind: "si", decimals: 1 };
    render(<FormatSpecEditor spec={spec} onChange={onChange} />);

    const kindSelect = screen.getByRole("combobox", { name: /format kind/i });
    fireEvent.change(kindSelect, { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
