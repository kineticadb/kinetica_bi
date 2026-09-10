# Phase 75: Column Display Config Foundation - Research

**Researched:** 2026-06-19
**Domain:** Server CRUD (SQLite), pure client formatter lib (d3-format), Zustand client store
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Config is GLOBAL per-table (not per-dashboard); formatting is CLIENT-SIDE ONLY and never constructs or mutates the SQL sent to Kinetica.
- Numbers: thousands separator (on/off), fixed decimal places (0–N), currency (configurable symbol prefix, default `$`), percent (NO ×100 — stored 42 renders `42%`), AND advanced d3-format string escape hatch.
- Dates/timestamps: preset formats + custom date-pattern escape hatch.
- Writes gated by `datasets:manage` (`PERMISSIONS.DATASETS_MANAGE`). Reads UNGATED.
- Per-column upsert: each `(table_id, column_name)` row is created/updated/deleted independently; the read endpoint returns ALL rows for a `table_id`.
- Client store: fetch-per-table, cached by `table_id`, version-bumped on edit — mirroring `filterViewStore`/`dynamicViewStore` Zustand patterns.
- `resolveLabel(col) → label ?? rawName`, `resolveFormatter(col) → fn ?? identity`.
- Formatter edge behavior: type mismatch → raw value; null/undefined → pass through as-is; invalid d3 string or date pattern → try/catch, return raw value; empty/absent spec → identity passthrough. Never throws, never crashes a render.

### Claude's Discretion
- Exact `format_spec` JSON schema (discriminated union by kind: `number` | `date` | `d3` advanced | `none`).
- Exact preset list contents and labels for dates.
- Store file layout, version-counter naming, and selector shapes (mirror existing stores).
- Endpoint URL shapes and request/response DTOs.
- Default format-kind inference from `inferDataTypeFromColumn`.

### Deferred Ideas (OUT OF SCOPE)
- Conditional / value-based formatting (color scales, thresholds on cell values).
- Per-dashboard (per dashboard+table) formatting overrides.
- Editor UI (Phase 76) and applying at render surfaces (Phase 77).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| COLCFG-V115-01 | Global per-table column display config persisted server-side with CRUD endpoints | DDL design, CRUD handler pattern, permission gate — all confirmed against existing code |
| COLCFG-V115-02 | Pure client-side formatter library — numbers + dates, invalid/empty → raw value fallback | d3-format v3.1.2 API confirmed; percent-without-×100 pattern documented; date approach decided |
| COLCFG-V115-03 | Client store + helpers loading table config, resolveLabel/resolveFormatter | filterViewStore + dynamicViewStore patterns fully confirmed |
</phase_requirements>

---

## Summary

Phase 75 has three independent deliverables that must be built in order (server first, then formatter lib, then store/helpers) because the store calls the server CRUD endpoints and the store helpers call the formatter lib.

The server side is a straightforward SQLite table + four CRUD endpoints patterned exactly on `/api/tables` and `dashboard_dynamic_views`. The `column_display_config` table has a composite primary key `(table_id, column_name)`, stores `label TEXT` and `format_spec TEXT` (JSON-in-TEXT, following the `columns_json` precedent), and uses `CREATE TABLE IF NOT EXISTS` for migration-free deployment across existing installs.

The pure formatter lib is the most technically nuanced deliverable. d3-format v3.1.2 covers all number preset cases. The CRITICAL decision is that the **percent preset must NOT use d3's native `%` type** (which multiplies by 100) — instead it formats the number numerically then appends a literal `%` suffix. The advanced d3 escape-hatch field passes strings directly to d3 with raw semantics (so `%` DOES multiply by 100 there — that's intentional for power users). Dates use the codebase's existing hand-rolled UTC formatter pattern (extend `columnTypes.ts`'s UTC getter approach) rather than adding d3-time-format as a second dependency.

The client store mirrors the `dynamicViewStore` shape exactly: `Record<tableId, entry>` + a numeric version counter that bumps on every mutation. The two helpers `resolveLabel` and `resolveFormatter` are pure selectors that read from cache.

**Primary recommendation:** Server → pure formatter lib → client store + helpers, in that order. Each is independently testable. Keep the formatter lib completely free of store/DOM/fetch imports.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `d3-format` | 3.1.2 (latest) | Number formatting (presets + advanced escape hatch) | Industry standard; zero deps; well-typed via @types |
| `@types/d3-format` | 3.0.4 (latest) | TypeScript declarations for d3-format | d3-format v3 does NOT ship its own .d.ts files — `@types/d3-format` from DefinitelyTyped is required |
| `better-sqlite3` | (already in project) | SQLite CRUD for column_display_config | Existing server dependency — no change |
| `zustand` | 4.5.2 (already in project) | Client store | Existing web dependency — no change |

**d3-format ships NO native TypeScript types.** Running `npm view d3-format` confirms no `types` field in package.json and no .d.ts files in dist/. `@types/d3-format@3.0.4` (DefinitelyTyped) is required as a devDependency in `packages/web`. Confidence: HIGH (verified via npm registry + unpkg package manifest).

### Workspace-Scoped Install (packages/web only)
```bash
# From monorepo root — target packages/web only
npm install d3-format --workspace=packages/web
npm install --save-dev @types/d3-format --workspace=packages/web
```

Or from within `packages/web`:
```bash
npm install d3-format
npm install --save-dev @types/d3-format
```

d3-format is a **zero-dependency** package (confirmed: `npm view d3-format deps: none`). Bundle impact is minimal (~17.9 kB unpacked).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| d3-format | `Intl.NumberFormat` (built-in) | Intl lacks the advanced-string escape hatch; d3 is already the project's charting ecosystem (recharts uses d3 internally) |
| Hand-rolled UTC date formatter | d3-time-format | See date decision below — hand-rolling is preferred |

---

## Architecture Patterns

### File Layout

```
packages/server/src/
├── db.ts                          # Add column_display_config table to SCHEMA_DDL
├── types.ts                       # Add ColumnDisplayConfigRow type
└── index.ts                       # Add 4 CRUD endpoints + list endpoint

packages/web/src/
├── lib/
│   └── columnFormatter.ts         # Pure formatter lib (COLCFG-V115-02)
│   └── columnFormatter.spec.ts    # Unit tests — no store/DOM/fetch imports
└── store/
    └── columnDisplayConfigStore.ts       # Zustand store + resolveLabel/resolveFormatter (COLCFG-V115-03)
    └── columnDisplayConfigStore.spec.ts  # Store unit tests
```

The shared TypeScript type `FormatSpec` (the discriminated union) should live in `packages/web/src/lib/columnFormatter.ts` because it is a pure client type. The server only stores it as a JSON-in-TEXT string and never introspects it.

### Pattern 1: Server DDL — JSON-in-TEXT column

Follows `dashboard_dynamic_views.columns_json` precedent exactly.

```typescript
// In db.ts SCHEMA_DDL (append after dashboard_access_grants block):
`
  -- v1.15 Phase 75 (COLCFG-V115-01): global per-table column display config.
  -- Keyed by (table_id, column_name). label is the operator display name (NULL = use
  -- raw column name). format_spec is JSON-encoded FormatSpec (NULL = no formatting).
  -- JSON-in-TEXT pattern mirrors dashboard_dynamic_views.columns_json.
  -- CREATE TABLE IF NOT EXISTS covers fresh + existing deployments; no ALTER needed.
  CREATE TABLE IF NOT EXISTS column_display_config (
    table_id INTEGER NOT NULL,
    column_name TEXT NOT NULL,
    label TEXT,
    format_spec TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (table_id, column_name)
  );
  CREATE INDEX IF NOT EXISTS idx_column_display_config_table_id ON column_display_config (table_id);
`
```

No migration ALTER block is needed — `CREATE TABLE IF NOT EXISTS` handles both fresh installs and existing deployments. The table is new in v1.15; there are no pre-existing rows to migrate.

### Pattern 2: Server CRUD endpoints

Mirror the `/api/tables` pattern (lines 2066–2097 in `index.ts`):

```typescript
// Source: packages/server/src/index.ts:2066-2097 (tables CRUD pattern)

// READ — ungated (any authenticated viewer can load display config for render surfaces)
app.get("/api/column-display-config/:tableId", requireAuth, (req, res) => {
  const tableId = Number(req.params.tableId);
  const rows = listColumnDisplayConfig(tableId); // returns all rows for this tableId
  return res.json({ data: rows });
});

// UPSERT — gated by datasets:manage
app.put("/api/column-display-config/:tableId/:columnName",
  ...requirePermission(PERMISSIONS.DATASETS_MANAGE),
  (req, res) => { ... }
);

// DELETE — gated by datasets:manage
app.delete("/api/column-display-config/:tableId/:columnName",
  ...requirePermission(PERMISSIONS.DATASETS_MANAGE),
  (req, res) => { ... }
);
```

The upsert uses SQLite's `INSERT OR REPLACE INTO` (or `INSERT INTO ... ON CONFLICT ... DO UPDATE SET`) to handle both create and update in a single endpoint — this matches the per-column granularity lock.

### Pattern 3: db.ts CRUD helpers

Mirror `mapDashboardDynamicView` / `getDashboardDynamicView` / `createDashboardDynamicView` pattern:

```typescript
// Source: packages/server/src/db.ts:702-776 (DynamicView CRUD)

const mapColumnDisplayConfig = (row: any): ColumnDisplayConfigRow => ({
  table_id: row.table_id,
  column_name: row.column_name,
  label: row.label ?? null,
  // format_spec is TEXT in SQLite; parse to object on read, re-stringify on write
  format_spec: row.format_spec ? JSON.parse(row.format_spec) : null,
  created_at: row.created_at,
  updated_at: row.updated_at,
});
```

### Pattern 4: Zustand store — mirror dynamicViewStore

The `dynamicViewStore` (v1.6) is the closest model: per-key cache + a single numeric version counter that bumps on EVERY mutation. Key shape:

```typescript
// Source: packages/web/src/store/dynamicViewStore.ts (full file)

export type ColumnDisplayConfigEntry = {
  // keyed by column_name
  columns: Record<string, { label: string | null; format_spec: FormatSpec | null }>;
};

export type ColumnDisplayConfigState = {
  configs: Record<number, ColumnDisplayConfigEntry>;  // keyed by table_id
  configVersion: number;                              // bumps on every setConfig/clearConfig
  setConfig: (tableId: number, rows: ColumnDisplayConfigRow[]) => void;
  upsertColumn: (tableId: number, colName: string, label: string | null, spec: FormatSpec | null) => void;
  removeColumn: (tableId: number, colName: string) => void;
  reset: () => void;
};
```

**Version bump rule** (from dynamicViewStore lock): bump `configVersion` on EVERY mutation — even a byte-identical payload. No-op only when key is absent and action is remove.

**Reset** wires into the existing lifecycle reset block (currently 7 stores). The column-config store is a read-heavy cache — resetting on logout/dashboard-switch is conservative and correct.

### Pattern 5: resolveLabel / resolveFormatter helpers

Pure selectors over the store — not methods on the store itself:

```typescript
// packages/web/src/lib/columnFormatter.ts (or a separate lib/columnDisplayHelpers.ts)

export const resolveLabel = (
  tableId: number,
  columnName: string,
): string => {
  const entry = useColumnDisplayConfigStore.getState().configs[tableId]?.columns[columnName];
  return entry?.label ?? columnName;  // falls back to raw column name
};

export const resolveFormatter = (
  tableId: number,
  columnName: string,
): (value: unknown) => string | unknown => {
  const entry = useColumnDisplayConfigStore.getState().configs[tableId]?.columns[columnName];
  if (!entry?.format_spec) return (v) => v;  // identity
  return buildFormatter(entry.format_spec);   // from pure formatter lib
};
```

Phase 77 render surfaces call `resolveLabel`/`resolveFormatter` at render time (reading live config, not at mount).

### Pattern 6: FormatSpec discriminated union

This is a Claude's Discretion area. Recommended shape:

```typescript
// packages/web/src/lib/columnFormatter.ts

export type FormatSpecNumber = {
  kind: "number";
  thousandsSep: boolean;    // true = use grouping separator
  decimals: number;         // 0–N fixed decimal places (0 = round to integer)
  currency: false | string; // false = no currency; string = symbol prefix (e.g. "$", "€")
  percent: boolean;         // true = append % WITHOUT ×100
};

export type FormatSpecDate = {
  kind: "date";
  preset: "iso" | "us" | "long" | "us_time" | "long_time" | "custom";
  customPattern?: string;   // only when preset === "custom"; hand-rolled UTC pattern string
};

export type FormatSpecD3 = {
  kind: "d3";
  specifier: string;        // raw d3-format string; passed verbatim — % DOES ×100 here
};

export type FormatSpecNone = {
  kind: "none";             // explicit no-op; stored when operator clears a prior spec
};

export type FormatSpec =
  | FormatSpecNumber
  | FormatSpecDate
  | FormatSpecD3
  | FormatSpecNone;
```

The `kind` discriminant makes switch exhaustiveness checking work at compile time. `FormatSpecNone` distinguishes "operator explicitly set no format" from "this column has no row at all" — useful for the Phase 76 editor to display a cleared state vs a missing config.

### Anti-Patterns to Avoid

- **Never use d3's `%` type for the percent PRESET.** It multiplies by 100. The preset must format the number numerically then append `%`. Only the `kind: "d3"` escape-hatch should receive raw specifiers that may include `%`.
- **Never import store/DOM/fetch in `columnFormatter.ts`.** The pure lib is fully unit-testable with no mocks.
- **Never use `inferDataTypeFromColumn` inside `columnFormatter.ts`.** Type inference belongs in the store or the Phase 76 editor — the pure formatter only reads `FormatSpec.kind`.
- **Never throw from `buildFormatter`.** Wrap d3's `format(specifier)` in try/catch and return the raw value on parse failure.
- **Never coerce null → '' in the formatter.** Null/undefined passes through as-is; render surfaces decide how to show blanks.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Number grouping separators, thousands formatting, SI prefixes | Custom regex | `d3-format` | Locale edge cases, minus sign, grouping array |
| Parsing a d3 format specifier to validate it | Custom parser | `d3.formatSpecifier(str)` wraps in try/catch | d3 throws on invalid specifier; catch that instead of re-parsing |
| Permission middleware | Custom auth check | `requirePermission(PERMISSIONS.DATASETS_MANAGE)` spread | Already handles requireAuth + rbacCheck in a two-element array |

**Key insight:** For number formatting with the advanced escape hatch, d3-format is the only correct approach — re-implementing a format specifier parser would be a large surface area of bugs.

---

## Common Pitfalls

### Pitfall 1: d3's `%` type multiplies by 100 — the percent PRESET must NOT use it
**What goes wrong:** `d3.format(".0%")(42)` returns `"4,200%"`. An operator storing `42` expecting `"42%"` gets a surprise 100× result.
**Why it happens:** d3's `%` type is designed for fractional values (0.42 → 42%), following conventional math. The product requirement stores already-scaled percentages.
**How to avoid:** The `kind: "number"` formatter with `percent: true` MUST format using a numeric specifier (e.g. `".Nf"`) then append `"%"` as a literal string. The `kind: "d3"` escape hatch intentionally passes the string verbatim — power users who type `.1%` there expect ×100 (this is documented in CONTEXT.md and the Phase 76 editor must warn about it).
**Warning signs:** Test `buildFormatter({ kind: "number", percent: true, decimals: 0, thousandsSep: false, currency: false })(42)` — it MUST return `"42%"`, not `"4200%"`.

### Pitfall 2: d3-format does NOT ship TypeScript types
**What goes wrong:** `import { format } from "d3-format"` produces tsc errors if `@types/d3-format` is missing.
**Why it happens:** d3-format v3.x is a pure JavaScript package; no `.d.ts` in its dist/ directory (verified via npm registry).
**How to avoid:** Install `@types/d3-format` as a devDependency in `packages/web`. This package is actively maintained at v3.0.4 on DefinitelyTyped.

### Pitfall 3: CREATE TABLE IF NOT EXISTS does NOT migrate existing rows
**What goes wrong:** If the `column_display_config` table ever needs a column added in a future phase, `CREATE TABLE IF NOT EXISTS` will silently succeed without adding the new column.
**Why it happens:** SQLite's `CREATE TABLE IF NOT EXISTS` is a no-op on existing tables.
**How to avoid:** The Phase 75 DDL is final for this column set. Any future column additions will need the PRAGMA-guarded ALTER pattern (documented in db.ts lines 236–304). No migration is needed NOW because this is a new table.

### Pitfall 4: JSON.parse on null in the mapper
**What goes wrong:** `JSON.parse(null)` throws in some JS environments; `JSON.parse(undefined)` always throws.
**Why it happens:** SQLite returns NULL as JS `null`; a row with no `format_spec` will have `row.format_spec === null`.
**How to avoid:** Always guard: `format_spec: row.format_spec ? JSON.parse(row.format_spec) : null` (this is the exact pattern used in `mapDashboardDynamicView` for `columns_json`).

### Pitfall 5: Store version counter must bump on EVERY mutation — not just net changes
**What goes wrong:** Checking `if (prev?.label === newLabel) return state;` to avoid bumps can cause Phase 76 / 77 consumers to miss a "confirmed save" signal.
**Why it happens:** The version counter is a dep-array trigger for effects, not a content hash. Version consumers use it to schedule re-reads, not to compare payloads.
**How to avoid:** Follow the `dynamicViewStore` contract exactly: bump `configVersion` unconditionally on `setConfig`/`upsertColumn`. No-op only on `removeColumn` when the key doesn't exist (same as `dynamicViewStore.clearView` strict no-op).

### Pitfall 6: FormatSpec validation in the server
**What goes wrong:** A Phase 76 client sends a `format_spec` payload with an unknown `kind`. The server stores it. Phase 77 renderer calls `buildFormatter` with an unknown kind and gets an identity passthrough silently.
**Why it happens:** The server stores format_spec as opaque JSON-in-TEXT and never validates it structurally.
**How to avoid:** The server can do a minimal validity check (e.g. parse the JSON, confirm `kind` is one of the known values) and return 400 on invalid payload. This is OPTIONAL for Phase 75 but worth noting for the planner.

---

## Code Examples

### Building a number formatter (correct percent approach)

```typescript
// Source: d3-format v3.1.2 API + CONTEXT.md percent constraint

import { format as d3Format, formatLocale } from "d3-format";

function buildNumberFormatter(spec: FormatSpecNumber): (v: unknown) => string | unknown {
  return (v: unknown) => {
    if (v === null || v === undefined) return v;
    const n = typeof v === "number" ? v : Number(v);
    if (isNaN(n)) return v; // type mismatch → raw value unchanged

    try {
      // Build d3 specifier from the number preset fields
      const commas = spec.thousandsSep ? "," : "";
      const prec = spec.decimals;
      const d3Spec = `${commas}.${prec}f`;  // e.g. ",.2f" or ".0f"

      const formatted = d3Format(d3Spec)(n);  // handles grouping + decimals

      // Currency prefix (placed BEFORE the number, regardless of d3 symbol position)
      if (spec.currency !== false) {
        return `${spec.currency}${formatted}`;
      }

      // Percent: append %, do NOT use d3 % type (would ×100)
      if (spec.percent) {
        return `${formatted}%`;
      }

      return formatted;
    } catch {
      return v; // invalid spec → raw value, never throw
    }
  };
}
```

**Key constraint:** currency placement is always prefix (CONTEXT.md: "placed BEFORE the number"). d3's `$` symbol uses the locale's `currency[0]`/`currency[1]` array — but for this codebase it is simpler and clearer to just prepend the symbol string manually rather than creating a per-call locale.

### Building a d3 escape-hatch formatter

```typescript
// Source: d3-format v3.1.2 format() API

function buildD3Formatter(spec: FormatSpecD3): (v: unknown) => string | unknown {
  return (v: unknown) => {
    if (v === null || v === undefined) return v;
    const n = typeof v === "number" ? v : Number(v);
    if (isNaN(n)) return v;

    try {
      return d3Format(spec.specifier)(n);
      // NOTE: d3's % type DOES ×100 here — raw d3 semantics, intentional for escape hatch
    } catch {
      return v; // invalid specifier → raw value, never throw
    }
  };
}
```

### Building a date formatter (hand-rolled UTC, no d3-time-format)

```typescript
// Pattern: extends columnTypes.ts formatDatetimeRange UTC approach
// Source: packages/web/src/lib/columnTypes.ts:99-178

const MONTH_NAMES_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"] as const;
const MONTH_NAMES_LONG  = ["January","February","March","April","May","June","July","August","September","October","November","December"] as const;

// Presets (all UTC, consistent with CalendarRenderer / chip text conventions)
// Inputs may be ISO string, epoch ms number, or epoch seconds number
type DatePreset = "iso" | "us" | "long" | "us_time" | "long_time";

function formatDatePreset(ms: number, preset: DatePreset): string {
  const d = new Date(ms);
  const yr  = d.getUTCFullYear();
  const mo  = d.getUTCMonth();
  const day = d.getUTCDate();
  const hh  = String(d.getUTCHours()).padStart(2, "0");
  const mm  = String(d.getUTCMinutes()).padStart(2, "0");
  switch (preset) {
    case "iso":      return `${yr}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    case "us":       return `${String(mo+1).padStart(2,"0")}/${String(day).padStart(2,"0")}/${yr}`;
    case "long":     return `${MONTH_NAMES_SHORT[mo]} ${day}, ${yr}`;
    case "us_time":  return `${String(mo+1).padStart(2,"0")}/${String(day).padStart(2,"0")}/${yr} ${hh}:${mm}`;
    case "long_time":return `${MONTH_NAMES_SHORT[mo]} ${day}, ${yr} ${hh}:${mm}`;
  }
}
```

**Date decision — hand-rolled UTC vs d3-time-format:**

Add d3-time-format as a SECOND new dependency? The codebase's existing UTC date formatting (`columnTypes.ts:99–178`, CalendarRenderer) already hand-rolls UTC getters with a MONTH_NAMES table. This pattern works, is consistent with the project, and avoids a second d3 sub-package. d3-time-format adds ~20 kB and is a meaningful dependency count increase for what amounts to 5 preset formatters + a simple custom-pattern parser. 

**Recommendation: EXTEND the hand-rolled UTC approach. Do NOT add d3-time-format.**

The custom date-pattern escape hatch can support a small token set: `YYYY`, `MM`, `DD`, `HH`, `mm`, `ss` — sufficient for the patterns the Phase 76 editor will expose. Wrap in try/catch; fall back to raw value on error. No need for a full strftime implementation.

### d3-format formatLocale (for reference — alternative to manual prefix)

```typescript
// Source: d3js.org/d3-format formatLocale API
// Only needed if using d3's $ symbol — we prefer manual prefix in this codebase

import { formatLocale } from "d3-format";

const customLocale = formatLocale({
  decimal: ".",
  thousands: ",",
  grouping: [3],
  currency: ["€", ""],  // [prefix, suffix]
  minus: "−",
});

customLocale.format("$,.2f")(1234.5); // "€1,234.50"
```

For this phase, **manual prefix prepending is preferred over formatLocale** because: (a) the operator provides any currency string, (b) we don't want to create a locale object per call, (c) it avoids the `$` symbol requirement in the specifier string.

### Server CRUD db helper

```typescript
// Pattern: mirrors mapDashboardDynamicView at packages/server/src/db.ts:702-750

export type ColumnDisplayConfigRow = {
  table_id: number;
  column_name: string;
  label: string | null;
  format_spec: unknown | null;  // FormatSpec on the web side; opaque object on server
  created_at: string;
  updated_at: string;
};

const mapColumnDisplayConfig = (row: any): ColumnDisplayConfigRow => ({
  table_id: row.table_id,
  column_name: row.column_name,
  label: row.label ?? null,
  format_spec: row.format_spec ? JSON.parse(row.format_spec) : null,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export const listColumnDisplayConfig = (tableId: number): ColumnDisplayConfigRow[] =>
  db.prepare("SELECT * FROM column_display_config WHERE table_id = ? ORDER BY column_name ASC")
    .all(tableId)
    .map(mapColumnDisplayConfig);

export const upsertColumnDisplayConfig = (
  tableId: number, columnName: string, label: string | null, formatSpec: unknown | null
): ColumnDisplayConfigRow => {
  db.prepare(`
    INSERT INTO column_display_config (table_id, column_name, label, format_spec)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(table_id, column_name) DO UPDATE SET
      label = excluded.label,
      format_spec = excluded.format_spec,
      updated_at = datetime('now')
  `).run(tableId, columnName, label ?? null, formatSpec ? JSON.stringify(formatSpec) : null);
  return getColumnDisplayConfig(tableId, columnName)!;
};

export const deleteColumnDisplayConfig = (tableId: number, columnName: string): boolean => {
  const result = db.prepare(
    "DELETE FROM column_display_config WHERE table_id = ? AND column_name = ?"
  ).run(tableId, columnName);
  return result.changes > 0;
};
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded column names in chart tooltips | resolveLabel() from store | Phase 75 (new) | Operators can rename any column display globally |
| No value formatting in BI layer | buildFormatter() from pure lib | Phase 75 (new) | Number/date rendering goes through a formatter chain |
| d3-format not in packages/web | d3-format 3.1.2 added | Phase 75 (new) | Enables advanced format-string escape hatch |

**What is NOT changing:**
- SQL sent to Kinetica — zero changes; formatting is presentation-only
- `inferDataTypeFromColumn` in `columnTypes.ts` — reused as-is for default-kind suggestion
- The `dashboard_dynamic_views` columns_json JSON-in-TEXT pattern — replicated for format_spec

---

## Confirmed Implementation Details

### Server: requireAuth on the read endpoint

The read endpoint `GET /api/column-display-config/:tableId` should use `requireAuth` (not `requirePermission`) — any authenticated user can read column display config so render surfaces work for analysts. This mirrors the read paths for tables (`GET /api/tables` at line 2066: `_req, res` — no auth at all) but since config is per-table and tied to operator setup, `requireAuth` is the right gate (anonymous callers cannot render dashboards anyway).

### Server: endpoint URL convention

URL shape recommendation: `/api/tables/:tableId/column-display-config` to co-locate with the existing `/api/tables/:id` routes. Alternative: top-level `/api/column-display-config/:tableId`. Either works — the key constraint is that the client store calls the same URL, so the planner should pick one and document it.

### Web: api/client.ts additions

New API client helpers for the column display config endpoints will be needed alongside the existing `listTables`, `getTableById` helpers. These fetch helpers follow the same `apiFetch` + `throwForStatus` pattern established at `packages/web/src/api/client.ts`.

### Web: inferDataTypeFromColumn → default FormatSpec.kind

```typescript
// packages/web/src/lib/columnFormatter.ts
import { inferDataTypeFromColumn } from "./columnTypes";

export function defaultFormatKind(
  colName: string,
  columns: Record<string, string>
): FormatSpec["kind"] {
  const dt = inferDataTypeFromColumn(colName, columns);
  if (dt === "number") return "number";
  if (dt === "datetime") return "date";
  return "none";
}
```

This drives the Phase 76 editor's initial picker state — it is NOT called by `buildFormatter` at render time (the formatter reads `spec.kind` directly).

---

## Test Approach

> Nyquist validation is disabled for this phase. The following test approach is informational for the planner — tests are expected but not formally tracked as a pre-commit gate beyond the existing vitest + tsc + theme-guard suite.

### Server tests (packages/server/tests/)

New spec file: `routes.column-display-config.spec.ts`

Pattern: `buildTestApp()` + `createAdminSession()` + `createAnalystSession()` (from existing helpers).

Key cases to cover:
- `GET /api/.../column-display-config` — 200 + correct shape for authenticated user; 401 for unauthenticated
- `PUT /api/.../column-display-config/.../:colName` — 200 for admin; 403 PERMISSION_DENIED for analyst
- `DELETE /api/.../column-display-config/.../:colName` — 200/204 for admin; 403 for analyst
- Upsert idempotency: second PUT on same `(tableId, colName)` updates, does not 409
- Delete non-existent: 404 (optional, but the tables CRUD returns 404 for missing rows)
- `format_spec` round-trips correctly: PUT with a JSON object, GET returns the same object

Both password auth and OIDC auth are covered by the `createAdminSession` / `createAnalystSession` helpers (which use JWT + the module-singleton db — same infra as all existing routes specs).

**Server vitest set-based gate:** server vitest uses a SET-BASED gate (failing files ⊆ TD-V16-TEST-ISOLATION known-flaky). Never assert a fixed pass count.

### Web tests (packages/web/src/)

**columnFormatter.spec.ts** — pure lib, ZERO store/DOM/fetch imports:
- `buildFormatter({ kind: "number", percent: true, ... })(42)` → `"42%"` (not `"4200%"`)
- `buildFormatter({ kind: "number", thousandsSep: true, decimals: 2, currency: "€", percent: false })(1234.5)` → `"€1,234.50"`
- `buildFormatter({ kind: "d3", specifier: ".1%" })(0.5)` → `"50.0%"` (raw d3 semantics: ×100 IS expected here)
- `buildFormatter({ kind: "d3", specifier: "INVALID$$#" })(42)` → `42` (raw value on invalid spec)
- `buildFormatter({ kind: "date", preset: "iso" })(Date.UTC(2026, 5, 19))` → `"2026-06-19"`
- `buildFormatter({ kind: "none" })(42)` → `42` (identity)
- `buildFormatter(null)(42)` → `42` (absent spec → identity)
- null/undefined passthrough: `buildFormatter(anySpec)(null)` → `null`

**columnDisplayConfigStore.spec.ts** — store behavior:
- `setConfig` populates `configs[tableId]`; `configVersion` increments
- `upsertColumn` on existing entry updates in place; `configVersion` increments
- `removeColumn` on non-existent key is a strict no-op (state reference preserved, no version bump)
- `reset()` zeros `configs` and `configVersion`

### Quick run commands
```bash
# Web formatter lib only
cd packages/web && npx vitest --run src/lib/columnFormatter.spec.ts

# Web full suite
cd packages/web && npm test

# Server spec only
cd packages/server && npx vitest --run tests/routes.column-display-config.spec.ts

# tsc gates (both must be clean)
cd packages/web && npx tsc --noEmit
cd packages/server && npx tsc --noEmit
```

---

## Open Questions

1. **Endpoint URL shape: table-scoped vs top-level**
   - What we know: both `/api/tables/:tableId/column-display-config` (table-scoped) and `/api/column-display-config/:tableId` (top-level) are viable
   - What's unclear: the planner's preference for REST nesting depth
   - Recommendation: `/api/tables/:tableId/column-display-config` for table-scoped co-location; individual column upsert/delete at `/api/tables/:tableId/column-display-config/:columnName`

2. **resolveLabel/resolveFormatter: in the store file or a separate lib file?**
   - What we know: both approaches are used elsewhere (`buildChipText` is in `columnTypes.ts`; store selectors are sometimes inlined)
   - What's unclear: whether Phase 77 render surfaces want a React hook or a pure function
   - Recommendation: pure functions in `packages/web/src/lib/columnFormatter.ts` that call `useColumnDisplayConfigStore.getState()` (Zustand snapshot access, outside React render). This keeps them testable without React.

3. **configVersion naming**
   - What we know: `filterViewStore` uses `materializeVersion` per-entry; `dynamicViewStore` uses `dynamicViewVersion` as a global top-level counter
   - What's unclear: whether Phase 76/77 need per-table or global version bump
   - Recommendation: single top-level `configVersion` (mirrors `dynamicViewVersion`). Phase 77 render surfaces can use `configVersion` as a dep-array trigger to re-resolve labels/formatters when any config changes.

---

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view d3-format`) — current version 3.1.2, zero deps, no TypeScript types in package
- npm registry (`npm view @types/d3-format`) — v3.0.4, actively maintained at DefinitelyTyped
- `packages/server/src/db.ts` — SCHEMA_DDL structure, JSON-in-TEXT precedent at line 119, migration ALTER pattern at lines 236–304
- `packages/server/src/index.ts:2066–2097` — tables CRUD gating pattern
- `packages/server/src/lib/permissions.ts` — `PERMISSIONS.DATASETS_MANAGE` confirmed
- `packages/server/src/rbac.ts` — `requirePermission` factory: returns `[requireAuth, rbacCheck]` array
- `packages/web/src/store/filterViewStore.ts` — per-key cache + version counter pattern
- `packages/web/src/store/dynamicViewStore.ts` — version-bump-on-every-mutation convention
- `packages/web/src/lib/columnTypes.ts` — `inferDataTypeFromColumn` at line 85, UTC date formatting pattern at lines 99–178
- `packages/web/src/api/client.ts:272–279` — `TableDto` shape confirmed (`columns: Record<string, string>`)
- `packages/server/tests/helpers/` — `buildTestApp`, `createAdminSession` helper shapes
- d3js.org/d3-format — format specifier syntax, `%` type multiplies by 100, `formatLocale` currency array, `formatSpecifier` API

### Secondary (MEDIUM confidence)
- `packages/web/src/lib/bigNumberFormat.ts` — existing percent formatting pattern (appends `%` without ×100) confirmed as project convention

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — d3-format version + TypeScript type situation verified against npm registry
- Architecture: HIGH — all patterns verified against live project source files
- Pitfalls: HIGH — d3 `%` behavior confirmed against official docs; JSON.parse null guard confirmed from db.ts mapper pattern

**Research date:** 2026-06-19
**Valid until:** 2026-07-19 (d3-format is stable; internal patterns are locked)
