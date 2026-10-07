import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useToastStore } from "./toast";

describe("toast store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("TOAST-ttl-plain: plain toast disappears at 5000 ms", () => {
    useToastStore.getState().showToast("a");
    vi.advanceTimersByTime(4999);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("TOAST-ttl-action: action toast lives 15000 ms and stores the action", () => {
    useToastStore.getState().showToast("b", "info", { label: "Download", onClick: vi.fn() });
    expect(useToastStore.getState().toasts[0].action?.label).toBe("Download");
    vi.advanceTimersByTime(14999);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("TOAST-dedup-unchanged: same kind+message within 5 s is suppressed", () => {
    useToastStore.getState().showToast("dup");
    useToastStore.getState().showToast("dup");
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});
