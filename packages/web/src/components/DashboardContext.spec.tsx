import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardContextProvider, useDashboardContext } from "./DashboardContext";
import type { WidgetDto, DynamicViewRow } from "../api/client";

// Tiny consumer that reads the hook and renders dashboardId as text — keeps the spec
// focused on the context contract, not on any specific widget renderer.
const Consumer = () => {
  const { dashboardId } = useDashboardContext();
  return <div data-testid="dashboard-id-readout">{dashboardId}</div>;
};

describe("DashboardContext", () => {
  // Suppress React's noisy "uncaught error during render" console.error for the
  // missing-context throw test — the throw is the assertion, not a surprise.
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("useDashboardContext returns the dashboardId when wrapped in the provider", () => {
    render(
      <DashboardContextProvider dashboardId={42} widgets={[]} dynamicViews={[]} retryDynamicView={() => {}}>
        <Consumer />
      </DashboardContextProvider>
    );
    expect(screen.getByTestId("dashboard-id-readout").textContent).toBe("42");
  });

  it("different dashboardId values flow through to consumers", () => {
    const { rerender } = render(
      <DashboardContextProvider dashboardId={1} widgets={[]} dynamicViews={[]} retryDynamicView={() => {}}>
        <Consumer />
      </DashboardContextProvider>
    );
    expect(screen.getByTestId("dashboard-id-readout").textContent).toBe("1");
    rerender(
      <DashboardContextProvider dashboardId={2} widgets={[]} dynamicViews={[]} retryDynamicView={() => {}}>
        <Consumer />
      </DashboardContextProvider>
    );
    expect(screen.getByTestId("dashboard-id-readout").textContent).toBe("2");
  });

  it("useDashboardContext throws when called outside the provider (fail-loud guard)", () => {
    // Render without provider — the hook's `if (ctx === null) throw` fires synchronously
    // during render. React rethrows during render; toThrow captures it.
    expect(() => render(<Consumer />)).toThrow(
      "useDashboardContext must be used inside DashboardContext.Provider"
    );
  });

  it("the throw is an Error instance (not a string or custom class)", () => {
    let caught: unknown = null;
    try {
      render(<Consumer />);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      "useDashboardContext must be used inside DashboardContext.Provider"
    );
  });

  // Phase 30 (MAT-V15-02): new tests for widgets field in context
  it("exposes widgets array in context value", () => {
    const sampleWidget: WidgetDto = {
      id: 1,
      dashboard_id: 1,
      title: "w",
      type: "bar",
      position: 0,
      config: {},
      created_at: "",
      updated_at: "",
    };
    const WidgetCountConsumer = () => {
      const { widgets } = useDashboardContext();
      return <div data-testid="widget-count">{widgets.length}</div>;
    };
    render(
      <DashboardContextProvider dashboardId={1} widgets={[sampleWidget]} dynamicViews={[]} retryDynamicView={() => {}}>
        <WidgetCountConsumer />
      </DashboardContextProvider>
    );
    expect(screen.getByTestId("widget-count").textContent).toBe("1");
  });

  it("exposes widgets: [] when provider receives an empty array", () => {
    const WidgetCountConsumer = () => {
      const { widgets } = useDashboardContext();
      return <div data-testid="widget-count">{widgets.length}</div>;
    };
    render(
      <DashboardContextProvider dashboardId={1} widgets={[]} dynamicViews={[]} retryDynamicView={() => {}}>
        <WidgetCountConsumer />
      </DashboardContextProvider>
    );
    expect(screen.getByTestId("widget-count").textContent).toBe("0");
  });

  it("preserves widgets reference equality across consumer reads", () => {
    const widgetsArr: WidgetDto[] = [
      {
        id: 42,
        dashboard_id: 1,
        title: "test-widget",
        type: "bar",
        position: 0,
        config: {},
        created_at: "",
        updated_at: "",
      },
    ];
    let ref1: WidgetDto[] | undefined;
    let ref2: WidgetDto[] | undefined;

    const Consumer1 = () => {
      ref1 = useDashboardContext().widgets;
      return null;
    };
    const Consumer2 = () => {
      ref2 = useDashboardContext().widgets;
      return null;
    };

    render(
      <DashboardContextProvider dashboardId={1} widgets={widgetsArr} dynamicViews={[]} retryDynamicView={() => {}}>
        <Consumer1 />
        <Consumer2 />
      </DashboardContextProvider>
    );
    expect(ref1).toBe(widgetsArr);
    expect(ref2).toBe(widgetsArr);
    expect(ref1).toBe(ref2);
  });

  // Phase 35 Plan 03 (DV-V16-13): new tests for dynamicViews field in context.
  describe("Phase 35 — dynamicViews context value", () => {
    const sampleRow: DynamicViewRow = {
      id: 7,
      dashboard_id: 1,
      source_table_id: 4,
      name: "dv-test",
      template_sql: "SELECT * FROM {view}",
      max_records: 10000,
      columns_json: null,
      created_at: "",
      updated_at: "",
    };

    it("exposes dynamicViews array in context value (non-empty)", () => {
      const DvCountConsumer = () => {
        const { dynamicViews } = useDashboardContext();
        return <div data-testid="dv-count">{dynamicViews.length}</div>;
      };
      render(
        <DashboardContextProvider
          dashboardId={1}
          widgets={[]}
          dynamicViews={[sampleRow]}
          retryDynamicView={() => {}}
        >
          <DvCountConsumer />
        </DashboardContextProvider>
      );
      expect(screen.getByTestId("dv-count").textContent).toBe("1");
    });

    it("exposes dynamicViews: [] when provider receives an empty array", () => {
      const DvCountConsumer = () => {
        const { dynamicViews } = useDashboardContext();
        return <div data-testid="dv-count">{dynamicViews.length}</div>;
      };
      render(
        <DashboardContextProvider dashboardId={1} widgets={[]} dynamicViews={[]} retryDynamicView={() => {}}>
          <DvCountConsumer />
        </DashboardContextProvider>
      );
      expect(screen.getByTestId("dv-count").textContent).toBe("0");
    });

    it("preserves dynamicViews reference equality across consumer reads", () => {
      const dvArr: DynamicViewRow[] = [sampleRow];
      let ref1: DynamicViewRow[] | undefined;
      let ref2: DynamicViewRow[] | undefined;

      const Consumer1 = () => {
        ref1 = useDashboardContext().dynamicViews;
        return null;
      };
      const Consumer2 = () => {
        ref2 = useDashboardContext().dynamicViews;
        return null;
      };

      render(
        <DashboardContextProvider dashboardId={1} widgets={[]} dynamicViews={dvArr} retryDynamicView={() => {}}>
          <Consumer1 />
          <Consumer2 />
        </DashboardContextProvider>
      );
      expect(ref1).toBe(dvArr);
      expect(ref2).toBe(dvArr);
      expect(ref1).toBe(ref2);
    });
  });
});
