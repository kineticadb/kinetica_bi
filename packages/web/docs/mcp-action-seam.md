# AI / MCP Action Seam

**Scope: design + documentation only**

> **NOT BUILT in v1.11:** No AI chat widget and no MCP server are built this milestone.
> This document records the hook a future AI-V2-01 / AI-V2-02 milestone reuses — zero new
> runtime code, zero new server routes.

---

## 1. Where It Lives

The single dispatch entry for widget-action application is:

```
packages/web/src/lib/applyWidgetAction.ts  →  applyWidgetAction()
```

The serializable action envelope is defined in:

```
packages/web/src/lib/widgetAction.ts  →  WidgetActionSchema / WidgetAction
```

The allow-list (the AI/MCP safety boundary) is:

```
packages/web/src/lib/actionAllowList.ts  →  validateActionPatch / ALLOW_LIST_VERSION
```

---

## 2. The Contract — Envelope Shape

`WidgetAction` is a **fully serializable** envelope with no closures or object references.
Every value survives a `JSON.parse(JSON.stringify(...))` round-trip unchanged — which is
precisely why an AI/MCP agent can emit it directly.

```typescript
// packages/web/src/lib/widgetAction.ts
import { z } from "zod";

export const WidgetActionTargetSchema = z.object({
  kind: z.enum(["widget", "layer", "dynamicView"]),
  id: z.number().int().positive(),
});

export const WidgetActionSchema = z.object({
  target: WidgetActionTargetSchema,
  configPatch: z.record(z.unknown()),
});

export type WidgetAction = z.infer<typeof WidgetActionSchema>;
// { target: { kind: "widget" | "layer" | "dynamicView", id: number }, configPatch: Record<string, unknown> }
```

The three target kinds map to the three persistent entity types:

| `target.kind`   | Entity                    | Persisted in                       |
| --------------- | ------------------------- | ---------------------------------- |
| `"widget"`      | Dashboard widget          | `widgets.config` (JSON blob)       |
| `"layer"`       | Dashboard map layer       | `dashboard_layers.config` + top-level fields |
| `"dynamicView"` | Dynamic view definition   | `dynamic_views.config` (JSON blob) |

---

## 3. The Safety Boundary — Allow-List

`validateActionPatch` in `actionAllowList.ts` is **the binding gate** an AI/MCP layer is
bound by. No free-form `Object.assign` — every field in `configPatch` must:

1. Not be a permanently-blocked meta/proto key (`id`, `__proto__`, `constructor`, `type`,
   `position`, `widgetId`, `dashboardId`, `dashboard_id`, `tableId`, `table_id`, `prototype`)
2. Be explicitly listed in the allow-list for the given `(kind, widgetType)` combination
3. Satisfy the field's zod validator (type + optional enum constraint)

The allow-list is versioned. The current version is:

```typescript
export const ALLOW_LIST_VERSION = "v2" as const;  // actionAllowList.ts
```

Bumping `ALLOW_LIST_VERSION` signals that the set of patchable fields has changed —
useful for auditing AI-surface changes.

### Current allow-list seed (`ALLOW_LIST_VERSION = "v2"`)

| Kind          | Widget Type | Field           | Validator                                                    | Location      |
| ------------- | ----------- | --------------- | ------------------------------------------------------------ | ------------- |
| `widget`      | `map`       | `show_popup`    | `z.boolean()`                                                | widget.config |
| `widget`      | `map`       | `show_scale_bar`| `z.boolean()`                                                | widget.config |
| `widget`      | `map`       | `show_fullscreen`| `z.boolean()`                                               | widget.config |
| `widget`      | `chart`     | `metric`        | `z.string()`                                                 | widget.config |
| `widget`      | `chart`     | `aggregation`   | `z.enum(["sum","avg","min","max","count","count_distinct"])`  | widget.config |
| `widget`      | `records`   | `page_size`     | `z.number().int().positive()`                                | widget.config |
| `layer`       | —           | `renderMode`    | `z.enum(["raster","heatmap","classbreak","contour"])`        | layer.config  |
| `layer`       | —           | `visible`       | `z.boolean()`                                                | layer.config  |
| `layer`       | —           | `opacity`       | `z.number().min(0).max(1)`                                   | layer.config  |
| `layer`       | —           | `track_config`  | `z.string()` (JSON string)                                   | layer (TOP-LEVEL) |
| `layer`       | —           | `cb_config`     | `z.string()` (JSON string)                                   | layer (TOP-LEVEL) |
| `dynamicView` | —           | `enabled`       | `z.boolean()`                                                | widget.config |

`getFieldLocation(kind, widgetType, field)` is the **single source of truth** for where a
field lives inside the data model — `applyWidgetAction` uses it to split layer patches into
`{ config: { ...nested } }` vs top-level DTO fields. Never hard-code field locations in
calling code.

---

## 4. Concrete MCP Tool Shape

When the AI/MCP milestone is built, `WidgetActionSchema` is used **directly** as the MCP
tool `inputSchema`. `@modelcontextprotocol/sdk` v1.x accepts any Standard Schema-compatible
library (including Zod v3) as `inputSchema` — no conversion wrapper needed.

```typescript
// Future: packages/mcp-server/src/index.ts
// DO NOT add @modelcontextprotocol/sdk this milestone — reference design only.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WidgetActionSchema } from "../../web/src/lib/widgetAction";
// (or from a packages/shared/ extraction if the monorepo gains a shared package)

const server = new McpServer({ name: "kinetica-bi", version: "2.0.0" });

server.registerTool(
  "apply_widget_action",
  {
    description:
      "Apply a configuration patch to a specific dashboard widget, layer, or dynamic view.",
    inputSchema: WidgetActionSchema, // same Zod schema the in-app dispatch validates against
  },
  async ({ target, configPatch }) => {
    // 1. Validate against the allow-list (same gate as the in-app path)
    const validation = validateActionPatch(target.kind, await resolveWidgetType(target), configPatch);
    if (!validation.valid) {
      return { content: [{ type: "text", text: `Rejected: ${validation.reasons.join("; ")}` }] };
    }

    // 2. Call the EXISTING PATCH routes — NO new routes needed
    if (target.kind === "widget") {
      // PATCH /api/widgets/:id
      const current = await fetchWidget(target.id);
      const newConfig = { ...current.config, ...configPatch };
      await fetch(`${BI_SERVER_URL}/api/widgets/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
        body: JSON.stringify({ config: newConfig }),
      });
    } else if (target.kind === "layer") {
      // Existing dashboard-layer PATCH route (handles top-level track_config/cb_config)
      const split = splitLayerPatch(configPatch);
      await fetch(`${BI_SERVER_URL}/api/dashboard-layers/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
        body: JSON.stringify({ config: split.config, ...split.topLevel }),
      });
    } else {
      // Existing dynamic-view PATCH route
      await fetch(`${BI_SERVER_URL}/api/dynamic-views/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
        body: JSON.stringify({ config: configPatch }),
      });
    }

    return { content: [{ type: "text", text: `Applied to ${target.kind} ${target.id}.` }] };
  }
);
```

### Existing server routes — NO new routes needed

| Target kind     | Route                                  | Note                                                  |
| --------------- | -------------------------------------- | ----------------------------------------------------- |
| `widget`        | `PATCH /api/widgets/:id`               | Accepts `{ config }` — full config replacement        |
| `layer`         | existing dashboard-layer PATCH route   | Handles top-level `track_config`/`cb_config` fields   |
| `dynamicView`   | existing dynamic-view PATCH route      | Accepts `{ config }` — full config replacement        |

No WebSocket, no action-log table, no event sourcing — the existing server surface suffices
for the first AI/MCP milestone.

---

## 5. In-App vs MCP — Same Envelope, Different Sink

The two paths share the same envelope (`WidgetAction`) and the same allow-list gate
(`validateActionPatch`), but diverge at persistence:

| Dimension              | In-app (`applyWidgetAction`)                    | MCP tool (`apply_widget_action`)               |
| ---------------------- | ----------------------------------------------- | ---------------------------------------------- |
| **Transport**          | Direct TypeScript function call (same process)  | MCP protocol (JSON-RPC over stdio/SSE)         |
| **Persistence**        | Session-only transient overlay (no PATCH)       | Calls existing PATCH routes → persisted to DB  |
| **On reload**          | Overlay cleared; dashboard reload shows saved   | Change is permanent; reload shows updated data |
| **Allow-list gate**    | `validateActionPatch` inside `applyWidgetAction`| `validateActionPatch` inside the MCP tool handler |
| **Envelope**           | `WidgetAction` / `WidgetActionSchema`           | `WidgetAction` / `WidgetActionSchema` (same)   |

The in-app `applyWidgetAction` is **TRANSIENT-ONLY** — it writes the session overlay store
and returns a typed `WidgetActionResult`. It never calls `updateWidget`, `updateLayer`, or
any server PATCH route. The session overlay is cleared on dashboard-switch / logout (the
`widgetActionStore.reset()` already in the dashboard cleanup sequence).

---

## 6. What Is NOT Built This Milestone (v1.11)

- No AI chat widget
- No MCP server (`packages/mcp-server/` does not exist)
- No `@modelcontextprotocol/sdk` dependency
- No new server routes
- No action-log table or event-sourcing layer
- No WebSocket action channel
- No AI session state or conversation persistence

The sole deliverable in v1.11 is this design document + the code-comment pointer in
`applyWidgetAction.ts`. The AI/MCP implementation is deferred to AI-V2-01 / AI-V2-02.

---

## 7. Future Extensibility Notes

- `WidgetActionSchema` can be extracted to a `packages/shared/` module when a
  `packages/mcp-server/` package is added — the import path is the only change required.
- Adding new patchable fields requires: (a) extending the allow-list seed in
  `actionAllowList.ts`, (b) bumping `ALLOW_LIST_VERSION`, (c) updating this table in §3.
- Deeper config nesting (e.g., patching one entry inside `config.layers[]`) is not needed
  for v1. If needed, compute the full replacement object before passing as `configPatch` —
  `{ ...existing, ...configPatch }` is a shallow merge by design.
- `@modelcontextprotocol/sdk` v1.29.0 is the last v1.x stable (2026-03-30). v2 is pre-alpha
  targeting Q3 2026. Target v1.x when building; the `registerTool` API is stable across v1.x.

---

*Requirement: SEAM-V111-01*
*Phase: 60-radio-renderer-wiring-persistence-mcp-seam-doc*
*Plan: 60-03*
*Documented: 2026-06-10 (design only — no implementation)*
