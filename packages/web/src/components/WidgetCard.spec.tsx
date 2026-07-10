// Phase 108 Plan 01 (FSCOPE-V120-02/03): WidgetCard extraction specs.
//
// Covers the two research-flagged HIGH risks:
//   1. Re-render isolation — a hover that highlights one widget must NOT re-render sibling
//      cards (scoped boolean selector + React.memo).
//   2. Flash-timer cleanup — the flash timeout must be cleared on unmount and on re-trigger
//      (no dangling timer, no post-unmount setState).
//
// WidgetRenderer is mocked to a cheap stub (it drives real chart/map rendering, irrelevant
// here); the badge components are left real (lightweight, safe with default-empty stores).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { WidgetCard } from "./WidgetCard";
import { useFilterHighlightStore } from "../store/filterHighlightStore";
import { useFilterStore, type ActiveFilter } from "../store/filterStore";
import type { WidgetDto } from "../api/client";

// Records every render of WidgetCard's body (mocked WidgetRenderer is invoked once per
// WidgetCard render — React.memo bails out entirely when props are unchanged, so a call
// here for a given widget id only happens when THAT card actually re-rendered).
const widgetRenderCalls: number[] = [];
vi.mock("./charts/WidgetRenderer", () => ({
  default: ({ widget }: { widget: { id: number } }) => {
    widgetRenderCalls.push(widget.id);
    return <div data-testid="widget-renderer-stub" />;
  },
}));
const renderCallsFor = (id: number) => widgetRenderCalls.filter((wid) => wid === id).length;

const makeWidget = (id: number, overrides: Partial<WidgetDto> = {}): WidgetDto => ({
  id,
  dashboard_id: 1,
  title: `Widget ${id}`,
  type: "bar",
  position: id,
  config: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const baseProps = {
  layers: [],
  associatedTables: [],
  targetsByTable: new Map<number, unknown>(),
  canEdit: false,
  canConfigure: false,
  onConfigure: vi.fn(),
  onDuplicate: vi.fn(),
  onRemove: vi.fn(),
};

beforeEach(() => {
  useFilterHighlightStore.getState().reset();
  useFilterStore.getState().reset();
  widgetRenderCalls.length = 0;
});

describe("WidgetCard — re-render isolation (HIGH risk regression)", () => {
  it("a hover that highlights one card does NOT re-render sibling cards", () => {
    render(
      <>
        <WidgetCard widget={makeWidget(1)} {...baseProps} />
        <WidgetCard widget={makeWidget(2)} {...baseProps} />
        <WidgetCard widget={makeWidget(3)} {...baseProps} />
      </>
    );

    expect(renderCallsFor(1)).toBe(1);
    expect(renderCallsFor(2)).toBe(1);
    expect(renderCallsFor(3)).toBe(1);

    act(() => {
      useFilterHighlightStore.getState().setHighlighted([2]);
    });

    // Only card 2's render fn should have re-run; siblings must NOT re-render.
    expect(renderCallsFor(1)).toBe(1);
    expect(renderCallsFor(2)).toBe(2);
    expect(renderCallsFor(3)).toBe(1);
  });

  it("setHighlighted applies widget-card--highlighted; clearHighlighted removes it", () => {
    render(<WidgetCard widget={makeWidget(5)} {...baseProps} />);
    const card = screen.getByText("Widget 5").closest(".widget-card") as HTMLElement;
    expect(card.className).not.toContain("widget-card--highlighted");

    act(() => {
      useFilterHighlightStore.getState().setHighlighted([5]);
    });
    expect(card.className).toContain("widget-card--highlighted");

    act(() => {
      useFilterHighlightStore.getState().clearHighlighted();
    });
    expect(card.className).not.toContain("widget-card--highlighted");
  });

  it("with the store empty, WidgetCard renders the same structure as before (inert extraction)", () => {
    render(<WidgetCard widget={makeWidget(9)} {...baseProps} />);
    const card = screen.getByText("Widget 9").closest(".widget-card") as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.className).toBe("widget-card");
    expect(screen.getByTestId("widget-renderer-stub")).toBeInTheDocument();
  });
});

describe("WidgetCard — deterministic flash-timer cleanup (HIGH risk regression)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the flash timer on unmount — no post-unmount setState", () => {
    const { unmount } = render(<WidgetCard widget={makeWidget(11)} {...baseProps} />);
    act(() => {
      useFilterHighlightStore.getState().flash([11]);
    });
    act(() => {
      vi.advanceTimersByTime(400); // < FLASH_MS
    });
    // Unmount before the flash timer would have fired — cleanup must clear it.
    // Suppress the "no output" act warning risk: advancing timers post-unmount must be a no-op.
    expect(() => {
      unmount();
      act(() => {
        vi.advanceTimersByTime(2000); // past FLASH_MS
      });
    }).not.toThrow();
  });

  it("re-triggering flash clears the prior timer (only one active timer; class restarts)", () => {
    render(<WidgetCard widget={makeWidget(12)} {...baseProps} />);
    const card = screen.getByText("Widget 12").closest(".widget-card") as HTMLElement;

    act(() => {
      useFilterHighlightStore.getState().flash([12]);
    });
    expect(card.className).toContain("widget-card--flashing");

    act(() => {
      vi.advanceTimersByTime(400); // still within the first FLASH_MS window
    });
    expect(card.className).toContain("widget-card--flashing");

    // Re-fire before the first timer would clear it — the effect must clear the PRIOR
    // timer (deps [isFlashing, flashNonce] both re-run since flashNonce bumps).
    act(() => {
      useFilterHighlightStore.getState().flash([12]);
    });
    expect(card.className).toContain("widget-card--flashing");

    // Advance past the FIRST timer's original deadline (400 + 700 = 1100 > 1000) — if the
    // prior timer had NOT been cleared, flashOn would have been forced false here even
    // though the re-trigger is still within its own fresh 1000ms window.
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(card.className).toContain("widget-card--flashing");

    // Advance past the SECOND (re-triggered) timer's deadline — now it clears.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(card.className).not.toContain("widget-card--flashing");
  });

  it("flash clears automatically after FLASH_MS", () => {
    render(<WidgetCard widget={makeWidget(13)} {...baseProps} />);
    const card = screen.getByText("Widget 13").closest(".widget-card") as HTMLElement;

    act(() => {
      useFilterHighlightStore.getState().flash([13]);
    });
    expect(card.className).toContain("widget-card--flashing");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(card.className).not.toContain("widget-card--flashing");
  });
});

describe("WidgetCard — calendar badge coalesce (Phase 109.2, FSCOPE-V120-05)", () => {
  it("a legacy respondToFilters:false calendar with an active filter from an EXCLUDED source renders the '0 of N' WidgetFilterBadge (coalesced cfg), not nothing", () => {
    const excludedFilter: ActiveFilter = {
      column: "order_date",
      operator: "eq",
      value: "2026-01-01",
      dataType: "datetime",
      sourceWidgetId: 999, // not this widget; not in the (empty) coalesced allow-list
      addedAt: Date.now(),
    };
    useFilterStore.getState().setBulkFilters(5, [excludedFilter]);

    render(
      <WidgetCard
        widget={makeWidget(20, {
          type: "calendar",
          config: { tableId: 5, respondToFilters: false },
        })}
        {...baseProps}
      />,
    );

    // Coalesced empty allow-list -> 0 of 1 applied -> badge renders (not null).
    const badge = screen.getByRole("status", { name: /0 of 1 filters applied/i });
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe("0 of 1 filters");
  });

  it("non-calendar widget badge behavior is unchanged — raw filterSelection read, no coalesce applied", () => {
    const excludedFilter: ActiveFilter = {
      column: "order_date",
      operator: "eq",
      value: "2026-01-01",
      dataType: "datetime",
      sourceWidgetId: 999,
      addedAt: Date.now(),
    };
    useFilterStore.getState().setBulkFilters(6, [excludedFilter]);

    render(
      <WidgetCard
        widget={makeWidget(21, {
          type: "bar",
          config: { tableId: 6 },
        })}
        {...baseProps}
      />,
    );

    // No filterSelection persisted -> accept-all default (unchanged, no coalesce) -> no badge.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
