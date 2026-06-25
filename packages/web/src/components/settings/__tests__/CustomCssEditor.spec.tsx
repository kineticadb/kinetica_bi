/**
 * RED tests for CustomCssEditor.tsx — verifies debounced draft injection,
 * cleanup-on-unmount, and stripped-declarations notice rendering.
 *
 * TDD Phase 83-03 Task 2.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { CustomCssEditor } from "../CustomCssEditor";

// Mock @uiw/react-codemirror so tests don't depend on DOM canvas/CodeMirror internals.
// The mock calls onChange whenever the "value" prop changes to simulate editor typing.
vi.mock("@uiw/react-codemirror", () => {
  const CodeMirror = ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange?: (v: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      data-testid="codemirror-mock"
      value={value}
      placeholder={placeholder}
      readOnly
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
  CodeMirror.displayName = "CodeMirror";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oneDark = {};
  return { default: CodeMirror, oneDark };
});

vi.mock("@codemirror/lang-css", () => ({
  css: () => ({}),
}));

// Mock theme store so tests don't need the full Zustand store
vi.mock("../../../store/theme", () => ({
  useThemeStore: (selector: (s: { theme: string }) => unknown) =>
    selector({ theme: "dark" }),
}));

describe("CustomCssEditor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Clean up any leftover draft style elements
    document.getElementById("kbi-brand-css-draft")?.remove();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.getElementById("kbi-brand-css-draft")?.remove();
  });

  it("renders the CodeMirror editor with the given value", () => {
    render(
      <CustomCssEditor value=".foo { color: red; }" onChange={vi.fn()} strippedNotice={null} />
    );
    expect(screen.getByTestId("codemirror-mock")).toBeInTheDocument();
  });

  it("injects CSS into kbi-brand-css-draft element after debounce", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CustomCssEditor value="" onChange={onChange} strippedNotice={null} />
    );

    // Simulate onChange being called (as if user typed)
    rerender(
      <CustomCssEditor value=".test { color: red; }" onChange={onChange} strippedNotice={null} />
    );

    // Before debounce fires — element may not exist yet or be empty
    const elBefore = document.getElementById("kbi-brand-css-draft");
    const textBefore = elBefore?.textContent ?? "";
    expect(textBefore).not.toBe(".test { color: red; }");

    // Advance timers past debounce (~400ms)
    await act(async () => {
      vi.advanceTimersByTime(450);
    });

    const el = document.getElementById("kbi-brand-css-draft");
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe(".test { color: red; }");
  });

  it("removes kbi-brand-css-draft element on unmount (cleanup)", async () => {
    const { rerender, unmount } = render(
      <CustomCssEditor value="" onChange={vi.fn()} strippedNotice={null} />
    );
    rerender(
      <CustomCssEditor value=".foo {}" onChange={vi.fn()} strippedNotice={null} />
    );
    // Fire debounce to create the element
    await act(async () => {
      vi.advanceTimersByTime(450);
    });
    expect(document.getElementById("kbi-brand-css-draft")).not.toBeNull();

    // Unmount = page leave
    unmount();
    expect(document.getElementById("kbi-brand-css-draft")).toBeNull();
  });

  it("does NOT write to kbi-custom-css (saved element)", async () => {
    // Ensure the saved element exists and is untouched
    const savedEl = document.createElement("style");
    savedEl.id = "kbi-custom-css";
    savedEl.textContent = ".saved {}";
    document.head.appendChild(savedEl);

    const { rerender } = render(
      <CustomCssEditor value="" onChange={vi.fn()} strippedNotice={null} />
    );
    rerender(
      <CustomCssEditor value=".draft {}" onChange={vi.fn()} strippedNotice={null} />
    );
    await act(async () => {
      vi.advanceTimersByTime(450);
    });

    // Saved element must remain untouched
    expect(document.getElementById("kbi-custom-css")?.textContent).toBe(".saved {}");

    // Cleanup
    document.getElementById("kbi-custom-css")?.remove();
  });

  it("shows stripped notice when strippedNotice prop is non-null", () => {
    render(
      <CustomCssEditor
        value=""
        onChange={vi.fn()}
        strippedNotice="Some declarations were removed by the server (url()/@import/@font-face/etc.)."
      />
    );
    expect(
      screen.getByText(/some declarations were removed/i)
    ).toBeInTheDocument();
  });

  it("does NOT show stripped notice when strippedNotice is null", () => {
    render(
      <CustomCssEditor value="" onChange={vi.fn()} strippedNotice={null} />
    );
    expect(screen.queryByText(/some declarations were removed/i)).toBeNull();
  });

  it("debounced injection updates on subsequent value changes", async () => {
    const { rerender } = render(
      <CustomCssEditor value="" onChange={vi.fn()} strippedNotice={null} />
    );

    rerender(<CustomCssEditor value=".first {}" onChange={vi.fn()} strippedNotice={null} />);
    await act(async () => { vi.advanceTimersByTime(450); });
    expect(document.getElementById("kbi-brand-css-draft")?.textContent).toBe(".first {}");

    rerender(<CustomCssEditor value=".second {}" onChange={vi.fn()} strippedNotice={null} />);
    await act(async () => { vi.advanceTimersByTime(450); });
    expect(document.getElementById("kbi-brand-css-draft")?.textContent).toBe(".second {}");
  });
});
