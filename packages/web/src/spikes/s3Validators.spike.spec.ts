/**
 * S3 spike (Phase 133): can per-widget-type zod validators be derived from the chart registry?
 * Harness, not a gate: skipped unless RUN_SPIKES=1.
 * Run: cd packages/web && RUN_SPIKES=1 npx vitest run src/spikes/s3Validators.spike.spec.ts
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { registerAllChartTypes } from "../components/charts/definitions";
import { getAllChartTypes, type ConfigField } from "../components/charts/registry";

const BINDING_KEYS = ["metric", "aggregation", "groupByColumns", "groupByColumn", "dimension", "tableId", "table", "tableRef", "dynamicViewId"];

const fieldSchema = (f: ConfigField): z.ZodTypeAny => {
  switch (f.type) {
    case "text":
    case "textarea":
    case "color":
      return z.string();
    case "number":
    case "range": {
      let n = z.number();
      if (typeof f.min === "number") n = n.min(f.min);
      if (typeof f.max === "number") n = n.max(f.max);
      return n;
    }
    case "boolean":
      return z.boolean();
    case "select": {
      const vals = (f.options ?? []).map((o) => o.value);
      return vals.length > 0 && vals.every((v) => typeof v === "string")
        ? z.enum(vals as [string, ...string[]])
        : z.string();
    }
    default:
      return z.unknown();
  }
};

describe.skipIf(!process.env.RUN_SPIKES)("S3 per-type validators", () => {
  it("scores every registered widget type", () => {
    registerAllChartTypes();
    const types = getAllChartTypes();
    const report = types.map((def) => {
      const fields = def.fields ?? [];
      const fieldKeys = new Set(fields.map((f) => f.key));
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const f of fields) shape[f.key] = fieldSchema(f).optional();
      const validator = z.object(shape).passthrough();
      const dc = def.defaultConfig ?? {};
      const uncovered = Object.keys(dc).filter((k) => !fieldKeys.has(k));
      const bindingOutside = BINDING_KEYS.filter((k) => k in dc && !fieldKeys.has(k));
      const acceptsDefault = validator.safeParse(dc).success;
      let tampered: Record<string, unknown> | null = null;
      const num = fields.find((f) => f.type === "number" || f.type === "range");
      const sel = fields.find((f) => f.type === "select" && (f.options ?? []).length > 0);
      if (num) tampered = { ...dc, [num.key]: "x" };
      else if (sel) tampered = { ...dc, [sel.key]: "__bogus__" };
      const rejectsTampered = tampered ? !validator.safeParse(tampered).success : null;
      return {
        type: def.type,
        fieldsCount: fields.length,
        uncoveredDefaultConfigKeys: uncovered,
        bindingKeysOutsideFields: bindingOutside,
        acceptsDefault,
        rejectsTampered,
        addable: def.addable ?? true,
        hasCustomPanel: !!def.CustomConfigPanel,
        customWhere: fieldKeys.has("customWhere") || "customWhere" in dc,
        colorFields: fields.filter((f) => f.type === "color").map((f) => f.key),
      };
    });
    const out = JSON.stringify(report, null, 2);
    console.log(out);
    // Console output may be swallowed by the vitest setup; optionally persist to S3_REPORT_PATH.
    if (process.env.S3_REPORT_PATH) writeFileSync(process.env.S3_REPORT_PATH, out);
    expect(report.length).toBe(16);
  });
});
