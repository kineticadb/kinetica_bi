import { describe, it, expect, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import Toast from "./Toast";
import { useToastStore } from "../store/toast";

describe("Toast", () => {
  it("TOAST-render-action: action button is ghost-sm between message and dismiss", () => {
    render(<Toast />);
    act(() => {
      useToastStore.getState().showToast("Export is ready", "info", { label: "Download", onClick: vi.fn() });
    });
    const btn = screen.getByRole("button", { name: "Download" });
    expect(btn.className).toBe("ghost-sm");
    const msg = document.querySelector(".toast-message")!;
    const dismiss = document.querySelector(".toast-dismiss")!;
    expect(msg.nextElementSibling).toBe(btn);
    expect(btn.nextElementSibling).toBe(dismiss);
  });

  it("TOAST-click-action: click runs onClick once and removes the toast", () => {
    const onClick = vi.fn();
    render(<Toast />);
    act(() => {
      useToastStore.getState().showToast("Ready click", "info", { label: "Download", onClick });
    });
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("TOAST-no-action: plain toast renders only the dismiss button", () => {
    render(<Toast />);
    act(() => {
      useToastStore.getState().showToast("Plain only");
    });
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });
});
