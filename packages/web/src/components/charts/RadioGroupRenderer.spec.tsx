/**
 * Phase 60 Plan 02 — RadioGroupRenderer spec.
 *
 * Covers:
 *   1. default-on-open: mount with defaultOptionId → derived widgetOverrides/layerOverrides
 *      reflect the default option's patch (applied transiently).
 *   2. select→live apply: fire change on a second option → derived overlay reflects the new
 *      option's patch; assert the renderer DOM node identity is unchanged (no remount).
 *   3. switch-replace reverts unset fields: option A sets { renderMode + cb_config } on a
 *      layer; select option B that sets only { renderMode } → derived layerOverrides[targetId]
 *      no longer contains cb_config (reverted to baseline). Ties to 60-01.
 *   4. dangling/rejected: option targets a non-existent layer → applyWidgetAction returns
 *      target_not_found, toast fires (spy useToastStore.showToast), renderer does not crash.
 *   5. reset clears: after a selection writes an overlay, call reset() → derived overlays empty.
 *   6. orientation + title render: vertical and horizontal produce the expected class;
 *      title renders when set.
 *   7. decoupling grep: readFileSync RadioGroupRenderer.tsx and assert no
 *      materializeFilter/setBulkFilters/addFilter/filterVersion/dashboardLayersStore import strings.
 *
 * Uses the real widgetActionStore (auto-reset by zustand shim in setup.ts).
 * applyWidgetAction is wired via DashboardContextProvider with a real closure
 * that calls the lib's applyWidgetAction(action, lookups, controlId).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import type { WidgetDto, DashboardLayerDto } from "../../api/client";
import { DashboardContextProvider } from "../DashboardContext";
import { useWidgetActionStore } from "../../store/widgetActionStore";
import { useToastStore } from "../../store/toast";
import { applyWidgetAction } from "../../lib/applyWidgetAction";
import type { WidgetAction } from "../../lib/widgetAction";
import type { RadioGroupConfig } from "../../lib/radioGroupConfig";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const makeRadioWidget = (config: RadioGroupConfig): WidgetDto => ({
  id: 42,
  dashboard_id: 1,
  title: "My Radio",
  type: "radiogroup",
  position: 0,
  config: config as unknown as Record<string, unknown>,
  created_at: "",
  updated_at: "",
});

const makeLayer = (id: number): DashboardLayerDto => ({
  id,
  dashboard_id: 1,
  table_id: 10,
  layer_type: "KineticaWms",
  position: 0,
  config: { spatialMode: "latlon", latColumn: "lat", lonColumn: "lon", renderMode: "raster", visible: true },
  info_enabled: 0,
  info_columns: null,
  info_template: null,
  dynamic_view_id: null,
  cb_config: null,
  track_config: null,
  created_at: "",
  updated_at: "",
} as DashboardLayerDto);

/** Build a RadioGroupConfig targeting a layer */
function layerTargetConfig(
  layerId: number,
  opts: {
    defaultOptionId?: string;
    orientation?: "vertical" | "horizontal";
    title?: string;
  } = {},
): RadioGroupConfig {
  const optA: RadioGroupConfig["options"][0] = {
    id: "opt-a",
    label: "Option A",
    action: {
      target: { kind: "layer", id: layerId },
      configPatch: { renderMode: "heatmap", cb_config: '{"breaks":[]}' },
    } as WidgetAction,
  };
  const optB: RadioGroupConfig["options"][0] = {
    id: "opt-b",
    label: "Option B",
    action: {
      target: { kind: "layer", id: layerId },
      configPatch: { renderMode: "classbreak" },
    } as WidgetAction,
  };
  return {
    orientation: opts.orientation ?? "vertical",
    defaultOptionId: opts.defaultOptionId,
    title: opts.title,
    options: [optA, optB],
  };
}

/** Wrap a radio widget in a DashboardContextProvider with a REAL applyWidgetAction closure. */
function wrapWithProvider(
  children: React.ReactNode,
  lookupLayers: DashboardLayerDto[] = [],
) {
  const widgets: WidgetDto[] = [];
  const applyAction = (action: WidgetAction, controlId: number) =>
    applyWidgetAction(action, { widgets, layers: lookupLayers, dynamicViewIds: [] }, controlId);

  return (
    <DashboardContextProvider
      dashboardId={1}
      widgets={widgets}
      dynamicViews={[]}
      retryDynamicView={() => {}}
      applyWidgetAction={applyAction}
    >
      {children}
    </DashboardContextProvider>
  );
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("RadioGroupRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWidgetActionStore.getState().reset();
  });

  /* ---- 1. default-on-open ---------------------------------------- */

  it("1. default-on-open: mounts with defaultOptionId and applies its action transiently", async () => {
    const { default: RadioGroupRenderer } = await import("./RadioGroupRenderer");
    const LAYER_ID = 200;
    const layer = makeLayer(LAYER_ID);
    const cfg = layerTargetConfig(LAYER_ID, { defaultOptionId: "opt-a" });
    const widget = makeRadioWidget(cfg);

    await act(async () => {
      render(wrapWithProvider(<RadioGroupRenderer widget={widget} />, [layer]));
    });

    // The default option's action should have been applied transiently
    const layerOverride = useWidgetActionStore.getState().layerOverrides[LAYER_ID];
    expect(layerOverride).toBeDefined();
    // opt-a sets renderMode=heatmap (under config) + cb_config at top level
    const cfgOverride = layerOverride?.config as Record<string, unknown> | undefined;
    expect(cfgOverride?.renderMode).toBe("heatmap");
  });

  /* ---- 2. select→live apply (no remount) -------------------------- */

  it("2. select→live apply: selecting a different option applies live without remounting", async () => {
    const { default: RadioGroupRenderer } = await import("./RadioGroupRenderer");
    const LAYER_ID = 201;
    const layer = makeLayer(LAYER_ID);
    const cfg = layerTargetConfig(LAYER_ID, { defaultOptionId: "opt-a" });
    const widget = makeRadioWidget(cfg);

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(wrapWithProvider(<RadioGroupRenderer widget={widget} />, [layer])));
    });

    // Store the renderer element reference (for no-remount assertion)
    const rendererEl = container.querySelector("[data-testid='radiogroup-renderer']");
    expect(rendererEl).not.toBeNull();
    const originalRef = rendererEl;

    // Select option B
    const optBInput = container.querySelector("[data-testid='radiogroup-option-opt-b'] input") ??
      container.querySelector("input[aria-label='Option B']");
    expect(optBInput).not.toBeNull();

    await act(async () => {
      fireEvent.click(optBInput!);
    });

    // opt-b sets renderMode=classbreak but NOT cb_config → layer overlay reflects that
    const layerOverride = useWidgetActionStore.getState().layerOverrides[LAYER_ID];
    const cfgOverride = layerOverride?.config as Record<string, unknown> | undefined;
    expect(cfgOverride?.renderMode).toBe("classbreak");

    // No remount: same DOM element
    const rendererAfter = container.querySelector("[data-testid='radiogroup-renderer']");
    expect(rendererAfter).toBe(originalRef);
  });

  /* ---- 3. switch-replace reverts unset fields --------------------- */

  it("3. switch-replace: selecting opt-B reverts fields that opt-A set but opt-B does not", async () => {
    const { default: RadioGroupRenderer } = await import("./RadioGroupRenderer");
    const LAYER_ID = 202;
    const layer = makeLayer(LAYER_ID);
    const cfg = layerTargetConfig(LAYER_ID, { defaultOptionId: "opt-a" });
    const widget = makeRadioWidget(cfg);

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(wrapWithProvider(<RadioGroupRenderer widget={widget} />, [layer])));
    });

    // After mounting with opt-a default: cb_config should be present
    const afterDefault = useWidgetActionStore.getState().layerOverrides[LAYER_ID];
    expect(afterDefault?.cb_config).toBe('{"breaks":[]}');

    // Now select opt-b (only sets renderMode)
    const optBInput = container.querySelector("[data-testid='radiogroup-option-opt-b'] input") ??
      container.querySelector("input[aria-label='Option B']");
    await act(async () => {
      fireEvent.click(optBInput!);
    });

    // switch-replace: cb_config is no longer in the derived overlay (reverted to baseline)
    const afterSwitch = useWidgetActionStore.getState().layerOverrides[LAYER_ID];
    expect(afterSwitch?.cb_config).toBeUndefined();
    // But renderMode is set by opt-b
    const cfgAfterSwitch = afterSwitch?.config as Record<string, unknown> | undefined;
    expect(cfgAfterSwitch?.renderMode).toBe("classbreak");
  });

  /* ---- 4. dangling/rejected → toast, no crash -------------------- */

  it("4. dangling target: option targets a non-existent layer → toast fires, renderer does not crash", async () => {
    const { default: RadioGroupRenderer } = await import("./RadioGroupRenderer");
    const LAYER_ID = 999; // not in lookup layers
    const cfg = layerTargetConfig(LAYER_ID, { defaultOptionId: "opt-a" });
    const widget = makeRadioWidget(cfg);

    const showToastSpy = vi.spyOn(useToastStore.getState(), "showToast");

    // Render with empty lookup layers (dangling target)
    await act(async () => {
      render(wrapWithProvider(<RadioGroupRenderer widget={widget} />, []));
    });

    // The renderer should still be present (no crash)
    expect(screen.getByTestId("radiogroup-renderer")).not.toBeNull();

    // Toast should have fired (target_not_found path)
    expect(showToastSpy).toHaveBeenCalled();
  });

  /* ---- 5. reset clears overlay ----------------------------------- */

  it("5. reset clears: reset() clears the overlay (reload/unmount semantics)", async () => {
    const { default: RadioGroupRenderer } = await import("./RadioGroupRenderer");
    const LAYER_ID = 203;
    const layer = makeLayer(LAYER_ID);
    const cfg = layerTargetConfig(LAYER_ID, { defaultOptionId: "opt-a" });
    const widget = makeRadioWidget(cfg);

    await act(async () => {
      render(wrapWithProvider(<RadioGroupRenderer widget={widget} />, [layer]));
    });

    // Overlay was applied by default
    expect(useWidgetActionStore.getState().layerOverrides[LAYER_ID]).toBeDefined();

    // Reset (simulate dashboard reload)
    await act(async () => {
      useWidgetActionStore.getState().reset();
    });

    // Derived overlays are empty
    expect(useWidgetActionStore.getState().layerOverrides[LAYER_ID]).toBeUndefined();
    expect(Object.keys(useWidgetActionStore.getState().contributions)).toHaveLength(0);
  });

  /* ---- 6. orientation + title render ----------------------------- */

  it("6. vertical orientation: container has the vertical orientation class", async () => {
    const { default: RadioGroupRenderer } = await import("./RadioGroupRenderer");
    const LAYER_ID = 204;
    const layer = makeLayer(LAYER_ID);
    const cfg = layerTargetConfig(LAYER_ID, { orientation: "vertical", title: "Pick Mode" });
    const widget = makeRadioWidget(cfg);

    const { container } = render(wrapWithProvider(<RadioGroupRenderer widget={widget} />, [layer]));

    expect(container.querySelector(".radiogroup--vertical")).not.toBeNull();
    expect(screen.getByText("Pick Mode")).not.toBeNull();
  });

  it("6. horizontal orientation: container has the horizontal orientation class", async () => {
    const { default: RadioGroupRenderer } = await import("./RadioGroupRenderer");
    const LAYER_ID = 205;
    const layer = makeLayer(LAYER_ID);
    const cfg = layerTargetConfig(LAYER_ID, { orientation: "horizontal" });
    const widget = makeRadioWidget(cfg);

    const { container } = render(wrapWithProvider(<RadioGroupRenderer widget={widget} />, [layer]));

    expect(container.querySelector(".radiogroup--horizontal")).not.toBeNull();
  });

  it("6. no title: title element absent when title is not set", async () => {
    const { default: RadioGroupRenderer } = await import("./RadioGroupRenderer");
    const LAYER_ID = 206;
    const layer = makeLayer(LAYER_ID);
    const cfg = layerTargetConfig(LAYER_ID, {});
    const widget = makeRadioWidget(cfg);

    const { container } = render(wrapWithProvider(<RadioGroupRenderer widget={widget} />, [layer]));

    expect(container.querySelector(".radiogroup-title")).toBeNull();
  });

  /* ---- 7. decoupling grep --------------------------------------- */

  it("7. decoupling grep: RadioGroupRenderer.tsx has no filter-store imports", () => {
    const rendererPath = join(
      __dirname,
      "RadioGroupRenderer.tsx",
    );
    const src = readFileSync(rendererPath, "utf-8");

    expect(src).not.toMatch(/materializeFilter/);
    expect(src).not.toMatch(/setBulkFilters/);
    expect(src).not.toMatch(/addFilter/);
    expect(src).not.toMatch(/filterVersion/);
    expect(src).not.toMatch(/dashboardLayersStore/);
  });
});
