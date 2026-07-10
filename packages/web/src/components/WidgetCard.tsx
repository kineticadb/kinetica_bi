import React, { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faGear, faClone } from "@fortawesome/free-solid-svg-icons";
import type { TableDto, WidgetDto, DashboardLayerDto } from "../api/client";
import { useFilterHighlightStore } from "../store/filterHighlightStore";
import WidgetRenderer from "./charts/WidgetRenderer";
import { FilteringBadge } from "./FilteringBadge";
import { MapFilteringBadge } from "./MapFilteringBadge";
import { WidgetFilterBadge } from "./WidgetFilterBadge";
import type { FilterSelectionConfig } from "../types/filterSelection";

/**
 * Phase 108 (FSCOPE-V120-02/03): extracted from the inline `.widget-card` JSX previously in
 * DashboardsPage.tsx's `widgets.map` body. Inner content (header, badges, actions, body/
 * WidgetRenderer) moves VERBATIM to keep chart/map rendering byte-identical.
 *
 * Subscribes to `filterHighlightStore` with SCOPED BOOLEAN selectors
 * (`s => s.highlightedIds.has(widget.id)`) so ONLY cards whose highlight/flash state
 * actually flips re-render — avoids the re-render storm (research HIGH-risk item).
 * Wrapped in `React.memo` so a sibling card's re-render never touches this one, provided
 * the parent passes stable callback props.
 *
 * Flash-timer cleanup is deterministic: the effect below clears the PRIOR timer before
 * arming a new one and returns a cleanup that always clears on unmount (research HIGH-risk
 * item — dangling timers firing setState after unmount).
 *
 * react-grid-layout INTEGRATION NOTE: RGL's <ResponsiveGridLayout> clones each mapped child
 * with `ref`/`className`/`style` (grid positioning) and further wraps it with react-resizable
 * (adds resize-handle elements as `children`) and react-draggable (adds
 * onMouseDown/onMouseUp/onTouchEnd). WidgetCard MUST forward all of these onto its root DOM
 * node — via `React.forwardRef` + a `...rest` spread + rendering `{children}` — or the grid
 * silently loses positioning/drag/resize (the `.react-grid-item` class never applies).
 */

const FLASH_MS = 1000;

type WidgetCardOwnProps = {
  widget: WidgetDto;
  layers: DashboardLayerDto[]; // for the mapTableIds IIFE
  associatedTables: TableDto[]; // WidgetRenderer `tables`
  targetsByTable: Map<number, unknown>; // spatialCapable check
  canEdit: boolean;
  canConfigure: boolean;
  onConfigure: (w: WidgetDto) => void;
  onDuplicate: (w: WidgetDto) => void;
  onRemove: (id: number) => void;
  // Phase 108-02 will pass this to register a ref-map entry for scroll-to-widget; optional
  // and unused here so this plan's extraction stays inert-when-empty.
  registerRef?: (id: number, el: HTMLDivElement | null) => void;
};

// Extend with the standard div attributes RGL/react-resizable/react-draggable inject
// (ref is handled separately via forwardRef, not part of this prop type).
type WidgetCardProps = WidgetCardOwnProps & Omit<React.HTMLAttributes<HTMLDivElement>, "onClick">;

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>): React.RefCallback<T> {
  return (node: T) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") ref(node);
      else (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}

function WidgetCardImpl(
  {
    widget: w,
    layers,
    associatedTables,
    targetsByTable,
    canEdit,
    canConfigure,
    onConfigure,
    onDuplicate,
    onRemove,
    registerRef,
    className,
    style,
    children,
    ...rest
  }: WidgetCardProps,
  forwardedRef: React.Ref<HTMLDivElement>
) {
  // Phase 16: for map widgets, derive the included layer tableIds so MapFilteringBadge
  // subscribes to ANY-of-N materializing semantics matching the MapChartRenderer's
  // includedLayers set. Mirrors the includedLayers useMemo at MapChartRenderer.tsx:159-171.
  const mapTableIds: number[] = (() => {
    if (w.type !== "map") return [];
    const cfg = (w.config ?? {}) as Record<string, unknown>;
    const ids = cfg.includedLayerIds as number[] | undefined;
    const filtered =
      ids === undefined || ids.length === 0 ? layers : layers.filter((l) => ids.includes(l.id));
    const visible = filtered.filter((l) => (l.config as { visible?: boolean }).visible !== false);
    return visible.map((l) => l.table_id);
  })();

  const cardRef = useRef<HTMLDivElement>(null);
  const isHighlighted = useFilterHighlightStore((s) => s.highlightedIds.has(w.id));
  const isFlashing = useFilterHighlightStore((s) => s.flashingIds.has(w.id));
  const flashNonce = useFilterHighlightStore((s) => s.flashNonce);
  const [flashOn, setFlashOn] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isFlashing) {
      setFlashOn(false);
      return;
    }
    setFlashOn(false);
    // Force reflow so the keyframe restarts even on an identical class (nonce-driven re-fire).
    void cardRef.current?.offsetWidth;
    setFlashOn(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFlashOn(false), FLASH_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isFlashing, flashNonce]);

  useEffect(() => {
    registerRef?.(w.id, cardRef.current);
    return () => registerRef?.(w.id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerRef, w.id]);

  return (
    <div
      {...rest}
      ref={mergeRefs(cardRef, forwardedRef)}
      style={style}
      className={`widget-card${className ? ` ${className}` : ""}${isHighlighted ? " widget-card--highlighted" : ""}${flashOn ? " widget-card--flashing" : ""}`}
    >
      <div className="widget-header">
        <span className="widget-drag-handle widget-title">{w.title}</span>
        {w.type === "map" ? (
          <MapFilteringBadge tableIds={mapTableIds} />
        ) : (
          <>
            <FilteringBadge tableId={(w.config as Record<string, unknown> | undefined)?.tableId as number | undefined} />
            <WidgetFilterBadge
              widgetId={w.id}
              cfg={(w.config as Record<string, unknown> | undefined)?.filterSelection as FilterSelectionConfig | undefined}
              tableId={(w.config as Record<string, unknown> | undefined)?.tableId as number | undefined}
              dynamicViewId={(w.config as Record<string, unknown> | undefined)?.dynamicViewId as number | undefined}
              spatialCapable={(() => {
                const tid = (w.config as Record<string, unknown> | undefined)?.tableId as number | undefined;
                return tid !== undefined && targetsByTable.has(tid);
              })()}
            />
          </>
        )}
        <div className="widget-actions">
          {canConfigure && (
            <button className="widget-configure" onClick={() => onConfigure(w)} title="Configure">
              <FontAwesomeIcon icon={faGear} />
            </button>
          )}
          {canEdit && (
            <button
              className="widget-configure widget-duplicate"
              onClick={() => onDuplicate(w)}
              title="Duplicate"
              aria-label="Duplicate widget"
            >
              <FontAwesomeIcon icon={faClone} />
            </button>
          )}
          {canEdit && (
            <button className="widget-remove" onClick={() => onRemove(w.id)} title="Remove">
              <FontAwesomeIcon icon={faXmark} />
            </button>
          )}
        </div>
      </div>
      <div className="widget-body">
        <WidgetRenderer
          widget={w}
          tables={associatedTables}
          onConfigureWidget={canConfigure ? (target) => onConfigure(target) : undefined}
        />
      </div>
      {children}
    </div>
  );
}

const WidgetCardWithRef = React.forwardRef(WidgetCardImpl);

export const WidgetCard = React.memo(WidgetCardWithRef);
