/**
 * Phase 110 Plan 01 (FSET-V120-01): DashboardSettingsModal spec.
 *
 * Coverage:
 *   1. Renders modal chrome (.modal-overlay/.modal-content/.modal-header/.modal-title
 *      "Dashboard Settings"/ghost-sm Close/.modal-body).
 *   2. Renders a .ds-field "Filter display" wrapping .radiogroup--buttons with exactly
 *      two .radiogroup-button segments: "Top bar" and "Right panel".
 *   3. mode="topbar" -> "Top bar" carries radiogroup-button--selected, "Right panel" does not.
 *   4. mode="panel" -> "Right panel" carries radiogroup-button--selected, "Top bar" does not.
 *   5. Clicking the non-selected segment calls onModeChange exactly once with the other value.
 *   6. Clicking the already-selected segment is a no-op (onModeChange not called).
 *   7. Clicking the overlay calls onClose; clicking inside modal-content does not.
 *   8. Clicking Close calls onClose.
 *   9. While onModeChange is in-flight (unresolved promise), both segment buttons are disabled.
 *  10. A rejected onModeChange surfaces a toast and keeps the modal open (no crash).
 *  11. No Save/Cancel footer buttons are rendered (save-on-change).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { DashboardSettingsModal } from "./DashboardSettingsModal";
import { useToastStore } from "../store/toast";

describe("DashboardSettingsModal", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [], _lastShown: new Map() });
  });

  it("renders modal chrome", () => {
    const { container } = render(
      <DashboardSettingsModal mode="topbar" onModeChange={vi.fn()} onClose={vi.fn()} />
    );
    expect(container.querySelector(".modal-overlay")).toBeInTheDocument();
    expect(container.querySelector(".modal-content")).toBeInTheDocument();
    expect(container.querySelector(".modal-header")).toBeInTheDocument();
    expect(screen.getByText("Dashboard Settings")).toHaveClass("modal-title");
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass("ghost-sm");
    expect(container.querySelector(".modal-body")).toBeInTheDocument();
  });

  it("renders a .ds-field 'Filter display' wrapping the two-segment .radiogroup--buttons control", () => {
    const { container } = render(
      <DashboardSettingsModal mode="topbar" onModeChange={vi.fn()} onClose={vi.fn()} />
    );
    const field = container.querySelector(".ds-field");
    expect(field).toBeInTheDocument();
    expect(field?.querySelector(".ds-field-label")?.textContent).toBe("Filter display");
    const segmented = field?.querySelector(".radiogroup--buttons");
    expect(segmented).toBeInTheDocument();
    const buttons = segmented?.querySelectorAll(".radiogroup-button");
    expect(buttons?.length).toBe(2);
    expect(screen.getByRole("button", { name: "Top bar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Right panel" })).toBeInTheDocument();
  });

  it("mode='topbar' selects Top bar, not Right panel", () => {
    render(<DashboardSettingsModal mode="topbar" onModeChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Top bar" })).toHaveClass("radiogroup-button--selected");
    expect(screen.getByRole("button", { name: "Right panel" })).not.toHaveClass("radiogroup-button--selected");
  });

  it("mode='panel' selects Right panel, not Top bar", () => {
    render(<DashboardSettingsModal mode="panel" onModeChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Right panel" })).toHaveClass("radiogroup-button--selected");
    expect(screen.getByRole("button", { name: "Top bar" })).not.toHaveClass("radiogroup-button--selected");
  });

  it("clicking the non-selected segment calls onModeChange exactly once with the other value", async () => {
    const onModeChange = vi.fn().mockResolvedValue(undefined);
    render(<DashboardSettingsModal mode="topbar" onModeChange={onModeChange} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Right panel" }));
    expect(onModeChange).toHaveBeenCalledTimes(1);
    expect(onModeChange).toHaveBeenCalledWith("panel");
  });

  it("clicking the already-selected segment is a no-op", async () => {
    const onModeChange = vi.fn().mockResolvedValue(undefined);
    render(<DashboardSettingsModal mode="topbar" onModeChange={onModeChange} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Top bar" }));
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it("clicking the overlay calls onClose; clicking inside modal-content does not", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <DashboardSettingsModal mode="topbar" onModeChange={vi.fn()} onClose={onClose} />
    );
    const content = container.querySelector(".modal-content") as HTMLElement;
    await userEvent.click(content);
    expect(onClose).not.toHaveBeenCalled();
    const overlay = container.querySelector(".modal-overlay") as HTMLElement;
    await userEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking Close calls onClose", async () => {
    const onClose = vi.fn();
    render(<DashboardSettingsModal mode="topbar" onModeChange={vi.fn()} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables both segment buttons while onModeChange is in-flight", async () => {
    let resolvePromise: () => void = () => {};
    const onModeChange = vi.fn(
      () => new Promise<void>((resolve) => { resolvePromise = resolve; })
    );
    render(<DashboardSettingsModal mode="topbar" onModeChange={onModeChange} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Right panel" }));
    expect(screen.getByRole("button", { name: "Top bar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Right panel" })).toBeDisabled();
    resolvePromise();
    await waitFor(() => expect(screen.getByRole("button", { name: "Top bar" })).not.toBeDisabled());
  });

  it("a rejected onModeChange toasts the error and keeps the modal open", async () => {
    const onModeChange = vi.fn().mockRejectedValue(new Error("network down"));
    const onClose = vi.fn();
    const { container } = render(
      <DashboardSettingsModal mode="topbar" onModeChange={onModeChange} onClose={onClose} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Right panel" }));
    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.kind === "error")).toBe(true);
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector(".modal-overlay")).toBeInTheDocument();
  });

  it("renders no Save/Cancel footer (save-on-change)", () => {
    render(<DashboardSettingsModal mode="topbar" onModeChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^cancel$/i })).toBeNull();
  });
});
