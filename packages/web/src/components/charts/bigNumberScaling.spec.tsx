/**
 * Quick 261116-bns — Big Number auto-fits its widget and has a "Font Size Scaling" option.
 *
 * jsdom has no layout, so "the number grows/shrinks with the widget" is NOT provable here; it is a
 * live (human/CDP) check. What IS provable — the structural preconditions:
 *   - the renderer exposes --bn-scale (clamped user scale) and --bn-chars (rendered length),
 *   - global.css makes .widget-bignumber a size container and sizes the value/label/sub-label from
 *     container units multiplied by var(--bn-scale),
 *   - the bignumber definition carries the fontScale field, and the number input honours step/min/max.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import WidgetRenderer from "./WidgetRenderer";
import ChartConfigPanel from "./ChartConfigPanel";
import { getChartType } from "./registry";
import { registerAllChartTypes } from "./definitions";
import * as clientModule from "../../api/client";
import type { WidgetDto } from "../../api/client";
import { DashboardContextProvider } from "../DashboardContext";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    runSql: vi.fn(),
    materializeFilter: vi.fn().mockResolvedValue({ viewName: "", expiresAt: Date.now() + 300000 }),
    dropFilterView: vi.fn().mockResolvedValue({ dropped: true }),
    listColumnDisplayConfig: vi.fn().mockResolvedValue([]),
  };
});

registerAllChartTypes();

const widget = (config: Record<string, unknown>): WidgetDto =>
  ({
    id: 501, dashboard_id: 1, title: "BN", type: "bignumber", position: 0,
    config: { sql: "SELECT SUM(fare) AS value FROM t", tableId: 42, ...config },
    created_at: "", updated_at: "",
  }) as unknown as WidgetDto;

const renderBn = async (config: Record<string, unknown>) => {
  vi.mocked(clientModule.runSql).mockResolvedValue({
    column_headers: ["value"], column_datatypes: ["double"], column_1: [1234],
  } as unknown as Awaited<ReturnType<typeof clientModule.runSql>>);
  const { container } = render(
    <DashboardContextProvider dashboardId={1} widgets={[]} dynamicViews={[]} retryDynamicView={() => {}}>
      <WidgetRenderer widget={widget(config)} />
    </DashboardContextProvider>,
  );
  await waitFor(() => expect(container.querySelector(".widget-bignumber-value")).not.toBeNull());
  return container.querySelector(".widget-bignumber") as HTMLElement;
};

describe("Big Number scaling (BNS)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("BNS-1 exposes --bn-scale (default 1) and --bn-chars (prefix + value + suffix length)", async () => {
    const el = await renderBn({ prefix: "$", suffix: " k" });
    const text = el.querySelector(".widget-bignumber-value")!.textContent!;
    expect(el.style.getPropertyValue("--bn-scale")).toBe("1");
    expect(el.style.getPropertyValue("--bn-chars")).toBe(String(text.length));
  });

  it("BNS-2 fontScale is applied, and invalid values fall back / clamp", async () => {
    for (const [input, expected] of [[1.5, "1.5"], [0, "1"], ["abc", "1"], [-2, "1"], [99, "4"], [0.1, "0.25"]] as const) {
      const el = await renderBn({ fontScale: input });
      expect(el.style.getPropertyValue("--bn-scale")).toBe(expected);
      cleanup();
    }
  });

  it("BNS-3 the bignumber definition has a Font Size Scaling field (default 1, 0.25–4 step 0.05)", () => {
    const f = getChartType("bignumber")!.fields.find((x) => x.key === "fontScale");
    expect(f).toMatchObject({ label: "Font Size Scaling", type: "number", defaultValue: 1, min: 0.25, max: 4, step: 0.05 });
    expect(f!.hint).toMatch(/Customize font size scaling to improve fit/);
    expect(getChartType("bignumber")!.defaultConfig.fontScale).toBe(1);
  });

  it("BNS-4 the config panel's number input honours step/min/max and shows the hint", () => {
    render(
      <ChartConfigPanel widgetType="bignumber" title="BN" config={{ fontScale: 1.25 }} tables={[]} onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    const input = screen.getByLabelText(/^Font Size Scaling/) as HTMLInputElement;
    expect(input.value).toBe("1.25");
    expect(input.step).toBe("0.05");
    expect(input.min).toBe("0.25");
    expect(input.max).toBe("4");
    expect(screen.getByText(/Customize font size scaling to improve fit/)).toBeInTheDocument();
  });

  it("BNS-5 global.css: size container + container-unit font sizes multiplied by --bn-scale", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/global.css"), "utf8");
    const rule = (sel: string) => {
      const m = css.match(new RegExp(`\\n${sel.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`));
      return m ? m[1] : "";
    };
    expect(rule(".widget-bignumber")).toMatch(/container-type:\s*size/);
    const value = rule(".widget-bignumber-value");
    expect(value).toMatch(/font-size:[^;]*cqh[^;]*var\(--bn-chars/);
    expect(value).toMatch(/font-size:[^;]*var\(--bn-scale/);
    expect(value).toMatch(/white-space:\s*nowrap/);
    for (const sel of [".widget-bignumber-label", ".widget-bignumber-sub"]) {
      expect(rule(sel)).toMatch(/font-size:[^;]*cq[hw][^;]*var\(--bn-scale/);
    }
  });
});
