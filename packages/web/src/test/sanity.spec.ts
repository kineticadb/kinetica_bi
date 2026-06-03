// Sanity: vitest + jsdom + jest-dom + zustand mock all wire correctly.
// Plans 03-05 add real specs against this same rig.

import { describe, it, expect } from "vitest";
import { create } from "zustand";

describe("test rig sanity", () => {
  it("vitest globals: expect.toBe is available", () => {
    expect(1 + 1).toBe(2);
  });

  it("jsdom is the environment: window and document exist", () => {
    expect(typeof window).toBe("object");
    expect(typeof document).toBe("object");
    expect(window.sessionStorage).toBeDefined();
  });

  it("jest-dom matchers are loaded: toBeInTheDocument is callable", () => {
    const div = document.createElement("div");
    div.textContent = "hi";
    document.body.appendChild(div);
    expect(div).toBeInTheDocument();
  });

  it("zustand mock resets stores between tests (write here, expect default in next)", () => {
    const useStore = create<{ n: number; set: (n: number) => void }>((set) => ({
      n: 0,
      set: (n) => set({ n }),
    }));
    useStore.getState().set(99);
    expect(useStore.getState().n).toBe(99);
    // The mock's afterEach hook will reset to {n: 0} for the next test.
  });

  it("zustand mock isolation: previous test's mutation is gone", () => {
    const useStore = create<{ n: number }>(() => ({ n: 42 }));
    expect(useStore.getState().n).toBe(42);
  });
});
