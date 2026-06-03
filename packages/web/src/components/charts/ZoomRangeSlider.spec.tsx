import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import ZoomRangeSlider, { type ZoomRangeValue } from "./ZoomRangeSlider";

describe("ZoomRangeSlider", () => {
  it("renders two thumbs at the provided [min, max] values", () => {
    render(<ZoomRangeSlider value={[3, 10]} onChange={() => {}} />);
    const minInput = screen.getByTestId("zoom-range-min") as HTMLInputElement;
    const maxInput = screen.getByTestId("zoom-range-max") as HTMLInputElement;
    expect(minInput.value).toBe("3");
    expect(maxInput.value).toBe("10");
    expect(screen.getByTestId("zoom-range-min-label")).toHaveTextContent("3");
    expect(screen.getByTestId("zoom-range-max-label")).toHaveTextContent("10");
  });

  it("emits onChange with new [min, max] when min thumb moves", () => {
    const onChange = vi.fn();
    render(<ZoomRangeSlider value={[3, 10]} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("zoom-range-min"), {
      target: { value: "5" },
    });
    expect(onChange).toHaveBeenCalledWith([5, 10]);
  });

  it("emits onChange with new [min, max] when max thumb moves", () => {
    const onChange = vi.fn();
    render(<ZoomRangeSlider value={[3, 10]} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("zoom-range-max"), {
      target: { value: "15" },
    });
    expect(onChange).toHaveBeenCalledWith([3, 15]);
  });

  it("clamps min ≤ max — dragging min past max collapses to [max, max]", () => {
    const onChange = vi.fn();
    render(<ZoomRangeSlider value={[3, 10]} onChange={onChange} />);
    // Operator tries to drag min thumb to 15 (past max=10).
    fireEvent.change(screen.getByTestId("zoom-range-min"), {
      target: { value: "15" },
    });
    // Both thumbs collapse to max=10 — single-zoom-level visibility. No swap.
    expect(onChange).toHaveBeenCalledWith([10, 10]);
  });

  it("clamps max ≥ min — dragging max below min collapses to [min, min]", () => {
    const onChange = vi.fn();
    render(<ZoomRangeSlider value={[3, 10]} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("zoom-range-max"), {
      target: { value: "1" },
    });
    expect(onChange).toHaveBeenCalledWith([3, 3]);
  });

  it("honors the min + max props for the underlying range inputs", () => {
    render(
      <ZoomRangeSlider value={[2, 18]} onChange={() => {}} min={1} max={20} />,
    );
    const minInput = screen.getByTestId("zoom-range-min") as HTMLInputElement;
    const maxInput = screen.getByTestId("zoom-range-max") as HTMLInputElement;
    expect(minInput.min).toBe("1");
    expect(minInput.max).toBe("20");
    expect(maxInput.min).toBe("1");
    expect(maxInput.max).toBe("20");
  });

  it("selected-track inline style reflects the value range as percentage offsets", () => {
    const { container } = render(
      <ZoomRangeSlider value={[7, 21]} onChange={() => {}} min={0} max={28} />,
    );
    const selected = container.querySelector(
      ".zoom-range-track-selected",
    ) as HTMLElement | null;
    expect(selected).not.toBeNull();
    // 7/28 = 25% left, (21-7)/28 = 50% width.
    expect(selected!.style.left).toBe("25%");
    expect(selected!.style.width).toBe("50%");
  });

  it("range===0 edge case (min===max bounds) renders without NaN in style", () => {
    const { container } = render(
      <ZoomRangeSlider value={[5, 5]} onChange={() => {}} min={5} max={5} />,
    );
    const selected = container.querySelector(
      ".zoom-range-track-selected",
    ) as HTMLElement;
    expect(selected.style.left).toBe("0%");
    expect(selected.style.width).toBe("0%");
  });

  it("typed onChange prop accepts ZoomRangeValue tuple — type compatibility", () => {
    const onChange = (next: ZoomRangeValue) => {
      // Compile-time tuple verification — `next` is readonly [number, number].
      const [a, b] = next;
      expect(typeof a).toBe("number");
      expect(typeof b).toBe("number");
    };
    render(<ZoomRangeSlider value={[0, 28]} onChange={onChange} />);
  });
});
