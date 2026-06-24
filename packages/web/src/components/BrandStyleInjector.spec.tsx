import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { BrandStyleInjector } from "./BrandStyleInjector";
import { useBrandStore } from "../store/brandStore";

describe("BrandStyleInjector", () => {
  beforeEach(() => {
    // Clean up any kbi-custom-css element between tests
    document.getElementById("kbi-custom-css")?.remove();
    useBrandStore.setState({ customCss: null });
  });

  it("creates a <style id='kbi-custom-css'> element in <head> on mount", () => {
    render(<BrandStyleInjector />);
    expect(document.getElementById("kbi-custom-css")).not.toBeNull();
  });

  it("sets textContent from customCss seeded in the store", () => {
    useBrandStore.setState({ customCss: ".x { color: red; }" });
    render(<BrandStyleInjector />);
    expect(document.getElementById("kbi-custom-css")?.textContent).toBe(".x { color: red; }");
  });

  it("sets textContent to empty string when customCss is null", () => {
    useBrandStore.setState({ customCss: null });
    render(<BrandStyleInjector />);
    expect(document.getElementById("kbi-custom-css")?.textContent).toBe("");
  });

  it("updates textContent when customCss changes in the store", () => {
    useBrandStore.setState({ customCss: ".initial { }" });
    const { rerender } = render(<BrandStyleInjector />);
    expect(document.getElementById("kbi-custom-css")?.textContent).toBe(".initial { }");

    useBrandStore.setState({ customCss: ".updated { background: blue; }" });
    rerender(<BrandStyleInjector />);
    expect(document.getElementById("kbi-custom-css")?.textContent).toBe(".updated { background: blue; }");
  });

  it("reuses existing <style> element (does not create duplicates)", () => {
    render(<BrandStyleInjector />);
    render(<BrandStyleInjector />);
    const elements = document.querySelectorAll("#kbi-custom-css");
    expect(elements.length).toBe(1);
  });

  it("renders null (returns no visible DOM node)", () => {
    const { container } = render(<BrandStyleInjector />);
    expect(container.children.length).toBe(0);
  });
});
