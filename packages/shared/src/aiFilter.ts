// Phase 138: source-keyed AI filter contract + the ONE pure coercion function shared by server gateway, web fold and dev harness.
import { z } from "zod";
import { AiIdentifierSchema } from "./actionAllowList";

export const AI_FILTER_CAP_PER_TABLE = 25; // must equal web filterStore FILTER_CAP_PER_TABLE (drift spec in 138-04)
export const AI_FILTER_OPERATORS = ["eq", "in", "between", "isNull"] as const;
export type AiFilterOperator = (typeof AI_FILTER_OPERATORS)[number];
export const AI_FILTER_DATA_TYPES = ["string", "number", "boolean", "datetime", "null"] as const;
export type AiFilterDataType = (typeof AI_FILTER_DATA_TYPES)[number];

const NonZeroId = z.number().int().refine((n) => n !== 0, { message: "id must be non-zero" });

export const AiFilterSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("table"), id: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("dynamicView"), id: NonZeroId }).strict(), // negative = AI temp dv; refused by gateway + fold until Phase 139
]);
export type AiFilterSource = z.infer<typeof AiFilterSourceSchema>;

const Scalar = z.union([z.string().max(200), z.number().finite(), z.boolean()]);
export const AiFilterItemSchema = z
  .object({
    column: AiIdentifierSchema,
    operator: z.enum(AI_FILTER_OPERATORS),
    value: z.union([Scalar, z.array(z.union([z.string().max(200), z.number().finite()])).max(100), z.null()]).optional(),
    dataType: z.enum(AI_FILTER_DATA_TYPES).optional(), // the gateway stamps the typed form
  })
  .strict();
export type AiFilterItem = z.infer<typeof AiFilterItemSchema>;

export function aiFilterSourceKey(s: AiFilterSource): string {
  return `${s.kind}:${s.id}`;
}

const UNFILTERABLE = new Set(["wkt", "wkb", "bytes", "blob", "text", "point", "geometry", "geography"]);
const NUMERIC = new Set([
  "int", "integer", "int8", "int16", "int32", "int64", "long", "float", "double", "double precision",
  "decimal", "numeric", "smallint", "bigint", "real", "number", "tinyint",
]);
const BOOLEAN = new Set(["bool", "boolean"]);
const DATETIME = new Set(["timestamp", "date", "time", "datetime"]);

export function aiFilterDataTypeOf(
  colType: string | undefined,
): "string" | "number" | "boolean" | "datetime" | "unfilterable" | "unknown" {
  if (colType === undefined) return "unknown";
  const t = colType.toLowerCase().replace(/\(.*\)/, "").trim();
  if (t === "") return "unknown";
  if (UNFILTERABLE.has(t)) return "unfilterable";
  if (NUMERIC.has(t)) return "number";
  if (BOOLEAN.has(t)) return "boolean";
  if (DATETIME.has(t)) return "datetime";
  return "string";
}

const isScalar = (v: unknown): boolean => typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/** Operator/value SHAPE only (no column types). */
export function checkAiFilterItem(item: AiFilterItem): string[] {
  const c = item.column;
  const v = item.value;
  switch (item.operator) {
    case "eq":
      return isScalar(v) ? [] : [`${c}: eq needs one value`];
    case "in":
      return Array.isArray(v) && v.length > 0 ? [] : [`${c}: in needs a list of values`];
    case "between": {
      const ok =
        Array.isArray(v) &&
        v.length === 2 &&
        ((typeof v[0] === "number" && typeof v[1] === "number") || (typeof v[0] === "string" && typeof v[1] === "string"));
      return ok ? [] : [`${c}: between needs two values of the same kind`];
    }
    case "isNull":
      return v === null || v === undefined ? [] : [`${c}: isNull takes no value`];
  }
}

const NUM_PLAIN = /^-?\d+(\.\d+)?$/;
const NUM_COMMA = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?Z?)?$/;

type One = { ok: true; value: string | number | boolean } | { ok: false; reason: string };

function coerceOne(v: unknown, kind: "string" | "number" | "boolean" | "datetime", c: string): One {
  switch (kind) {
    case "number": {
      if (typeof v === "number" && Number.isFinite(v)) return { ok: true, value: v };
      if (typeof v === "string" && (NUM_PLAIN.test(v) || NUM_COMMA.test(v))) {
        const n = Number(v.replace(/,/g, ""));
        if (Number.isFinite(n)) return { ok: true, value: n };
      }
      return { ok: false, reason: `column ${c} needs a number` };
    }
    case "boolean": {
      if (typeof v === "boolean") return { ok: true, value: v };
      if (typeof v === "string") {
        const l = v.toLowerCase();
        if (l === "true") return { ok: true, value: true };
        if (l === "false") return { ok: true, value: false };
      }
      return { ok: false, reason: `column ${c} needs true or false` };
    }
    case "datetime": {
      if (typeof v === "string" && DATE_RE.test(v) && Number.isFinite(Date.parse(v))) return { ok: true, value: v };
      return { ok: false, reason: `column ${c} needs a date like 2024-01-31` };
    }
    default:
      return { ok: true, value: String(v) };
  }
}

export function coerceAiFilterItem(
  item: AiFilterItem,
  colType: string | undefined,
): { ok: true; item: AiFilterItem & { dataType: AiFilterDataType } } | { ok: false; reason: string } {
  const c = item.column;
  const errs = checkAiFilterItem(item);
  if (errs.length > 0) return { ok: false, reason: errs[0] };
  const dt = aiFilterDataTypeOf(colType);
  if (dt === "unfilterable") return { ok: false, reason: `column ${c} can't be filtered` };
  const kind = dt === "unknown" ? "string" : dt;
  if (item.operator === "isNull") return { ok: true, item: { column: c, operator: "isNull", value: null, dataType: "null" } };
  if (item.operator === "eq") {
    const r = coerceOne(item.value, kind, c);
    return r.ok ? { ok: true, item: { column: c, operator: "eq", value: r.value, dataType: kind } } : r;
  }
  const raw = item.value as Array<string | number>;
  const out: Array<string | number | boolean> = [];
  for (const el of raw) {
    const r = coerceOne(el, kind, c);
    if (!r.ok) return r;
    out.push(r.value);
  }
  if (item.operator === "between" && (kind === "number" || kind === "datetime")) {
    const [a, b] = out;
    const from = kind === "number" ? (a as number) : Date.parse(a as string);
    const to = kind === "number" ? (b as number) : Date.parse(b as string);
    if (from > to) return { ok: false, reason: `column ${c}: the range start is after its end` };
  }
  return { ok: true, item: { column: c, operator: item.operator, value: out as Array<string | number>, dataType: kind } };
}
